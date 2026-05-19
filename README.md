# META 快速上傳工作台

本工具用來整理短影音影片、文案、發布時間、FB 粉專與 IG 商業帳號，並提供 Meta OAuth 與帳號載入的串接基礎。

## 本機啟動

```powershell
python meta_connector.py
```

開啟：

```text
http://127.0.0.1:8812/index.html
```

## Meta 設定

複製 `meta_config.example.json` 成 `meta_config.json`，填入：

- `app_id`
- `app_secret`
- `redirect_uri`

本機 redirect URI：

```text
http://127.0.0.1:8812/api/meta/oauth/callback
```

## Render 部署

Render 會使用 `render.yaml`。部署後在 Render 環境變數填：

- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`

Render redirect URI 範例：

```text
https://你的-render-service.onrender.com/api/meta/oauth/callback
```

同一個 URI 也要加入 Meta 開發者後台的 Valid OAuth Redirect URIs。
