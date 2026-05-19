const http = require("http");

const PORT = 8788;

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/meta/schedule") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(req));

    // Keep the token on the server in production. The frontend field is only
    // for local testing and should be removed once OAuth is wired in.
    const result = {
      received: payload.items?.length || 0,
      facebookPageId: payload.facebookPageId || null,
      instagramBusinessAccountId: payload.instagramBusinessAccountId || null,
      graphVersion: payload.graphVersion || "v20.0",
      nextStep: "Replace this stub with Meta Graph API video upload and schedule calls."
    };

    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Meta connector example listening on http://127.0.0.1:${PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
