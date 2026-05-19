from __future__ import annotations

import json
import mimetypes
import os
import secrets
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlencode, unquote, urlparse
from urllib.request import Request, urlopen
from zipfile import ZipFile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8812"))
CONFIG_PATH = ROOT / "meta_config.json"
TOKEN_PATH = ROOT / "meta_token.json"
STATE_PATH = ROOT / "meta_oauth_state.txt"

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "officeRel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


class MetaConnectorHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/meta/status":
            self.handle_meta_status()
            return
        if parsed.path == "/api/meta/oauth/start":
            self.handle_oauth_start()
            return
        if parsed.path == "/api/meta/oauth/callback":
            self.handle_oauth_callback(parsed)
            return
        if parsed.path == "/api/meta/accounts":
            self.handle_meta_accounts()
            return

        aliases = {
            "/privacy": "privacy.html",
            "/delete": "data-deletion.html",
            "/data-deletion": "data-deletion.html",
        }
        target = aliases.get(parsed.path)
        if not target:
            target = "index.html" if parsed.path in ("", "/") else unquote(parsed.path).lstrip("/")
        path = (ROOT / target).resolve()
        if not str(path).startswith(str(ROOT)) or not path.exists() or path.is_dir():
            self.send_json(404, {"error": "Not found"})
            return

        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(path.read_bytes())

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/captions/parse":
            self.handle_caption_parse()
            return
        if parsed.path == "/api/meta/schedule":
            self.handle_meta_schedule()
            return
        self.send_json(404, {"error": "Not found"})

    def handle_caption_parse(self):
        upload = read_multipart_file(self)
        if not upload:
            self.send_json(400, {"error": "Missing file"})
            return

        try:
            blocks = parse_caption_xlsx(upload["content"])
            self.send_json(200, {"fileName": upload["filename"], "blocks": blocks})
        except Exception as error:
            self.send_json(400, {"error": str(error)})

    def handle_meta_status(self):
        config = load_config()
        token = load_token()
        self.send_json(
            200,
            {
                "configured": bool(config.get("app_id") and config.get("app_secret")),
                "hasToken": bool(token.get("access_token")),
                "graphVersion": config.get("graph_version", "v24.0"),
                "redirectUri": config.get("redirect_uri", f"http://{HOST}:{PORT}/api/meta/oauth/callback"),
            },
        )

    def handle_oauth_start(self):
        config = require_config()
        state = secrets.token_urlsafe(24)
        STATE_PATH.write_text(state, encoding="utf-8")
        params = {
            "client_id": config["app_id"],
            "redirect_uri": config["redirect_uri"],
            "state": state,
            "response_type": "code",
            "scope": ",".join(config.get("scopes") or default_scopes()),
        }
        url = f"https://www.facebook.com/{config.get('graph_version', 'v24.0')}/dialog/oauth?{urlencode(params)}"
        self.send_response(302)
        self.send_header("Location", url)
        self.end_headers()

    def handle_oauth_callback(self, parsed):
        query = parse_qs(parsed.query)
        code = query.get("code", [""])[0]
        state = query.get("state", [""])[0]
        expected_state = STATE_PATH.read_text(encoding="utf-8").strip() if STATE_PATH.exists() else ""

        if not code or not state or state != expected_state:
            self.send_html(400, "Meta 授權失敗：state 或 code 不正確。")
            return

        try:
            config = require_config()
            short_token = exchange_code_for_token(config, code)
            long_token = exchange_long_lived_token(config, short_token["access_token"])
            save_token(long_token)
            self.send_html(200, "Meta 授權完成。可以回到工具頁按「載入粉專/IG 帳號」。")
        except Exception as error:
            self.send_html(400, f"Meta 授權失敗：{error}")

    def handle_meta_accounts(self):
        try:
            token = require_token()
            config = load_config()
            version = config.get("graph_version", "v24.0")
            fields = "id,name,access_token,instagram_business_account{id,username,name}"
            data = graph_get(f"https://graph.facebook.com/{version}/me/accounts", {
                "fields": fields,
                "access_token": token["access_token"],
            })
            pages = []
            ig_accounts = []
            for page in data.get("data", []):
                pages.append({"name": page.get("name", ""), "id": page.get("id", "")})
                ig = page.get("instagram_business_account") or {}
                if ig.get("id"):
                    ig_accounts.append({
                        "name": ig.get("username") or ig.get("name") or page.get("name", ""),
                        "id": ig["id"],
                        "pageId": page.get("id", ""),
                        "pageName": page.get("name", ""),
                    })
            self.send_json(200, {"pages": pages, "instagramAccounts": ig_accounts})
        except Exception as error:
            self.send_json(400, {"error": str(error)})

    def handle_meta_schedule(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            items = payload.get("items", [])
            self.send_json(
                200,
                {
                    "received": len(items),
                    "mode": "draft",
                    "nextStep": "OAuth and account discovery are ready. The next implementation step is actual video upload and scheduled publish.",
                    "sampleTargets": [
                        {
                            "videoName": item.get("videoName"),
                            "facebookPageId": item.get("facebookPageId"),
                            "instagramBusinessAccountId": item.get("instagramBusinessAccountId"),
                            "scheduledAt": item.get("scheduledAt"),
                        }
                        for item in items[:3]
                    ],
                },
            )
        except Exception as error:
            self.send_json(400, {"error": str(error)})

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status, payload):
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))

    def send_html(self, status, message):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        body = f"<!doctype html><meta charset='utf-8'><title>Meta OAuth</title><body><h1>{message}</h1></body>"
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, format, *args):
        return


def default_scopes():
    return [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "instagram_basic",
        "instagram_content_publish",
    ]


def load_config():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
    env_config = {
        "app_id": os.environ.get("META_APP_ID"),
        "app_secret": os.environ.get("META_APP_SECRET"),
        "graph_version": os.environ.get("META_GRAPH_VERSION"),
        "redirect_uri": os.environ.get("META_REDIRECT_URI"),
    }
    for key, value in env_config.items():
        if value:
            config[key] = value
    if os.environ.get("META_SCOPES"):
        config["scopes"] = [scope.strip() for scope in os.environ["META_SCOPES"].split(",") if scope.strip()]
    return config


def require_config():
    config = load_config()
    if not config.get("app_id") or not config.get("app_secret"):
        raise RuntimeError("請先建立 meta_config.json，填入 app_id 與 app_secret。")
    config.setdefault("graph_version", "v24.0")
    config.setdefault("redirect_uri", f"http://{HOST}:{PORT}/api/meta/oauth/callback")
    config.setdefault("scopes", default_scopes())
    return config


def load_token():
    if not TOKEN_PATH.exists():
        return {}
    return json.loads(TOKEN_PATH.read_text(encoding="utf-8"))


def require_token():
    token = load_token()
    if not token.get("access_token"):
        raise RuntimeError("尚未完成 Meta 登入授權。")
    return token


def save_token(token):
    token["saved_at"] = int(time.time())
    TOKEN_PATH.write_text(json.dumps(token, ensure_ascii=False, indent=2), encoding="utf-8")


def exchange_code_for_token(config, code):
    url = f"https://graph.facebook.com/{config['graph_version']}/oauth/access_token"
    return graph_get(url, {
        "client_id": config["app_id"],
        "client_secret": config["app_secret"],
        "redirect_uri": config["redirect_uri"],
        "code": code,
    })


def exchange_long_lived_token(config, access_token):
    url = f"https://graph.facebook.com/{config['graph_version']}/oauth/access_token"
    return graph_get(url, {
        "grant_type": "fb_exchange_token",
        "client_id": config["app_id"],
        "client_secret": config["app_secret"],
        "fb_exchange_token": access_token,
    })


def graph_get(url, params):
    request = Request(f"{url}?{urlencode(params)}", headers={"Accept": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def read_multipart_file(handler):
    content_type = handler.headers.get("Content-Type", "")
    marker = "boundary="
    if marker not in content_type:
        return None

    boundary = content_type.split(marker, 1)[1].strip().strip('"')
    length = int(handler.headers.get("Content-Length", "0"))
    body = handler.rfile.read(length)
    boundary_bytes = ("--" + boundary).encode("utf-8")

    for part in body.split(boundary_bytes):
        part = part.strip()
        if not part or part == b"--" or b"\r\n\r\n" not in part:
            continue

        header_blob, content = part.split(b"\r\n\r\n", 1)
        headers = header_blob.decode("utf-8", errors="ignore")
        if 'name="file"' not in headers:
            continue

        filename = "upload.xlsx"
        for header_line in headers.split("\r\n"):
            if "filename=" not in header_line:
                continue
            filename = header_line.split("filename=", 1)[1].strip().strip('"')

        if content.endswith(b"\r\n"):
            content = content[:-2]
        if content.endswith(b"--"):
            content = content[:-2]
        return {"filename": filename, "content": content}

    return None


def parse_caption_xlsx(content: bytes):
    with ZipFile(BytesIO(content)) as zf:
        shared_strings = read_shared_strings(zf)
        workbook_root = ET.fromstring(zf.read("xl/workbook.xml"))
        rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rels = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in rel_root.findall("rel:Relationship", NS)
        }

        blocks = []
        for sheet in workbook_root.findall("main:sheets/main:sheet", NS):
            sheet_name = sheet.attrib.get("name", "")
            rel_id = sheet.attrib.get(f"{{{NS['officeRel']}}}id")
            target = rels.get(rel_id, "")
            if not target:
                continue

            sheet_path = "xl/" + target.lstrip("/")
            if sheet_path not in zf.namelist():
                sheet_path = "xl/worksheets/" + Path(target).name

            rows = read_sheet_rows(zf, sheet_path, shared_strings)
            blocks.extend(rows_to_caption_blocks(rows, sheet_name))

        return blocks


def read_shared_strings(zf: ZipFile):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall("main:si", NS):
        values.append("".join(node.text or "" for node in item.findall(".//main:t", NS)))
    return values


def read_sheet_rows(zf: ZipFile, path: str, shared_strings):
    root = ET.fromstring(zf.read(path))
    rows = []
    for row in root.findall(".//main:sheetData/main:row", NS):
        cells = {}
        for cell in row.findall("main:c", NS):
            ref = cell.attrib.get("r", "")
            col = "".join(ch for ch in ref if ch.isalpha())
            cells[col] = read_cell_value(cell, shared_strings)
        rows.append(cells)
    return rows


def read_cell_value(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    value_node = cell.find("main:v", NS)
    inline_node = cell.find("main:is/main:t", NS)
    if inline_node is not None:
        return inline_node.text or ""
    if value_node is None:
        return ""
    value = value_node.text or ""
    if cell_type == "s":
        return shared_strings[int(value)] if value.isdigit() and int(value) < len(shared_strings) else ""
    return excel_date_or_raw(value)


def excel_date_or_raw(value: str):
    try:
        number = float(value)
    except ValueError:
        return value
    if 20000 <= number <= 60000:
        base = datetime(1899, 12, 30)
        return (base.fromordinal(base.toordinal() + int(number))).strftime("%Y-%m-%d")
    if number.is_integer():
        return str(int(number))
    return value


def rows_to_caption_blocks(rows, sheet_name):
    if not rows:
        return []

    field_by_col = {col: normalize_header(value) for col, value in rows[0].items()}
    item_col = find_col(field_by_col, ("項次", "標號", "編號", "item", "no"))
    caption_col = find_col(field_by_col, ("文案", "caption", "copy", "內容"))
    schedule_col = find_col(field_by_col, ("排程", "發布", "schedule", "publish"))

    if not caption_col:
        return []

    blocks = []
    for index, row in enumerate(rows[1:], start=2):
        caption = clean_text(row.get(caption_col, ""))
        if not caption:
            continue
        item_value = normalize_item_label(row.get(item_col, "")) if item_col else ""
        schedule_value = clean_text(row.get(schedule_col, "")) if schedule_col else ""
        title = item_value or f"{sheet_name} 第 {index - 1} 則"
        raw = "\n".join(part for part in (title, caption, schedule_value) if part)
        blocks.append({
            "title": title,
            "text": caption,
            "raw": raw,
            "sheet": sheet_name,
            "sourceRow": index,
            "sourceItem": item_value,
            "scheduledAt": normalize_schedule(schedule_value),
        })
    return blocks


def normalize_header(value):
    return clean_text(value).lower().replace(" ", "")


def clean_text(value):
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def find_col(field_by_col, candidates):
    for col, header in field_by_col.items():
        if any(candidate.lower() in header for candidate in candidates):
            return col
    return None


def normalize_schedule(value):
    value = clean_text(value)
    if not value:
        return ""
    if len(value) == 10 and value.count("-") == 2:
        return f"{value}T12:00"
    if " " in value:
        return value.replace(" ", "T")[:16]
    return value


def normalize_item_label(value):
    value = clean_text(value)
    if not value:
        return ""
    if value.endswith(".0") and value[:-2].isdigit():
        return value[:-2]
    if len(value) == 10 and value.count("-") == 2:
        month, day = value[5:7], value[8:10]
        return f"{int(month)}/{int(day)}"
    return value


if __name__ == "__main__":
    bind_host = os.environ.get("BIND_HOST", HOST)
    httpd = ThreadingHTTPServer((bind_host, PORT), MetaConnectorHandler)
    print(f"META connector running at http://{bind_host}:{PORT}/index.html")
    httpd.serve_forever()
