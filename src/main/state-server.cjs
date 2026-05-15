const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const stateMachine = require("../shared/state-machine.json");
const { createStateStore, createStateMachine } = require("../shared/state-store.cjs");

const { normalizeStateId } = createStateMachine(stateMachine);

const LOCALHOST_ORIGINS = new Set([
  "http://127.0.0.1", "http://localhost",
  "http://127.0.0.1:17388", "http://localhost:17388",
  "http://127.0.0.1:17389", "http://localhost:17389"
]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function corsOrigin(req) {
  const origin = req.headers.origin || "";
  if (!origin) return "http://127.0.0.1";
  try {
    const parsed = new URL(origin);
    const base = `${parsed.protocol}//${parsed.hostname}`;
    const full = parsed.port ? `${base}:${parsed.port}` : base;
    if (LOCALHOST_ORIGINS.has(full) || LOCALHOST_ORIGINS.has(base)) return origin;
  } catch {}
  return "http://127.0.0.1";
}

function sendJson(res, status, value, req) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": corsOrigin(req),
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, body, req, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": corsOrigin(req),
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function fileContentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".atlas") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".skel") return "application/octet-stream";
  return "application/octet-stream";
}

function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function createCompanionServer(config, publicConfig) {
  const store = createStateStore(config, stateMachine);
  const sseClients = new Set();
  const assetRootState = {
    current: config.spine.assetDir ? path.resolve(config.spine.assetDir) : ""
  };

  function broadcastSse(event, value) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const res of sseClients) res.write(payload);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "OPTIONS") {
        sendText(res, 204, "", req);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, state: store.snapshot() }, req);
        return;
      }

      if (req.method === "GET" && url.pathname === "/config") {
        sendJson(res, 200, publicConfig(), req);
        return;
      }

      if (req.method === "GET" && url.pathname === "/state") {
        sendJson(res, 200, store.snapshot(), req);
        return;
      }

      if (req.method === "POST" && url.pathname === "/state") {
        sendJson(res, 200, store.setState(await readBody(req)), req);
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/state/")) {
        const body = await readBody(req);
        body.state = decodeURIComponent(url.pathname.slice("/state/".length));
        sendJson(res, 200, store.setState(body), req);
        return;
      }

      if (req.method === "GET" && url.pathname === "/reminders") {
        sendJson(res, 200, { reminders: store.listReminders() }, req);
        return;
      }

      if (req.method === "POST" && url.pathname === "/reminders") {
        sendJson(res, 201, store.createReminder(await readBody(req)), req);
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": corsOrigin(req),
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8"
        });
        sseClients.add(res);
        res.write(`event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/assets/spine/")) {
        const assetRoot = assetRootState.current;
        if (!assetRoot) {
          sendText(res, 404, "No Spine assetDir is configured.", req);
          return;
        }
        const relative = decodeURIComponent(url.pathname.slice("/assets/spine/".length));
        const file = path.resolve(assetRoot, relative);
        if (!isInside(assetRoot, file) && file !== assetRoot) {
          sendText(res, 403, "Forbidden", req);
          return;
        }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          sendText(res, 404, "Asset not found", req);
          return;
        }
        res.writeHead(200, {
          "Access-Control-Allow-Origin": corsOrigin(req),
          "Content-Type": fileContentType(file)
        });
        fs.createReadStream(file).pipe(res);
        return;
      }

      sendJson(res, 404, { error: "Not found" }, req);
    } catch (error) {
      sendJson(res, 400, { error: error.message }, req);
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "state", payload: store.snapshot() }));
    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        const payload = parsed.payload || parsed;
        store.setState({ ...payload, source: payload.source || "websocket" });
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", error: error.message }));
      }
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  store.emitter.on("state", (state) => {
    broadcastSse("state", state);
    const message = JSON.stringify({ type: "state", payload: state });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  });

  return {
    server,
    store,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.server.port, config.server.host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      for (const client of wss.clients) client.close();
      server.close();
    },
    setAssetRoot(nextAssetRoot) {
      assetRootState.current = nextAssetRoot ? path.resolve(nextAssetRoot) : "";
    }
  };
}

module.exports = {
  createCompanionServer,
  normalizeStateId
};
