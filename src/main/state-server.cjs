const EventEmitter = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const stateMachine = require("../shared/state-machine.json");

const allowedStates = new Set(stateMachine.states);

function normalizeStateId(value) {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = stateMachine.aliases[raw] || raw;
  return allowedStates.has(normalized) ? normalized : "idle";
}

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

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function contentType(file) {
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

function createStateStore(config) {
  const emitter = new EventEmitter();
  const reminders = new Map();
  let current = {
    state: normalizeStateId(config.state?.initial || "idle"),
    message: "",
    source: "system",
    direction: "right",
    updatedAt: new Date().toISOString()
  };

  function snapshot() {
    return { ...current };
  }

  function setState(input = {}) {
    const previous = current;
    const requested = input.state || input.id || input.status;
    const nextState = requested ? normalizeStateId(requested) : previous.state;
    const direction = nextState === "running" ? (input.direction || previous.direction || "right") : "right";
    current = {
      ...previous,
      ...input,
      state: nextState,
      id: nextState,
      direction,
      updatedAt: new Date().toISOString(),
      source: input.source || previous.source || "local"
    };
    delete current.status;
    for (const key of ["reminderId", "autoReturnMs", "returnTo", "durationMs", "delayMs", "inSeconds", "dueAt", "at"]) {
      if (!(key in input)) delete current[key];
    }
    emitter.emit("state", snapshot());

    const autoReturnMs = Number(input.autoReturnMs || 0);
    if (autoReturnMs > 0) {
      const stateAtSchedule = current.updatedAt;
      setTimeout(() => {
        if (current.updatedAt !== stateAtSchedule) return;
        setState({
          state: input.returnTo || previous.state || "idle",
          source: "auto-return",
          message: ""
        });
      }, autoReturnMs);
    }

    return snapshot();
  }

  function createReminder(input = {}) {
    const id = input.id || `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    let dueAtMs = input.dueAt ? Date.parse(input.dueAt) : NaN;
    if (!Number.isFinite(dueAtMs) && input.at) dueAtMs = Date.parse(input.at);
    if (!Number.isFinite(dueAtMs) && input.inSeconds) dueAtMs = now + Number(input.inSeconds) * 1000;
    if (!Number.isFinite(dueAtMs) && input.delayMs) dueAtMs = now + Number(input.delayMs);
    if (!Number.isFinite(dueAtMs)) dueAtMs = now + 10_000;

    const reminder = {
      id,
      text: String(input.text || input.message || "Reminder"),
      dueAt: new Date(dueAtMs).toISOString(),
      createdAt: new Date(now).toISOString(),
      fired: false
    };

    const timeout = setTimeout(() => {
      reminder.fired = true;
      reminder.firedAt = new Date().toISOString();
      setState({
        state: "reminder",
        source: "reminder",
        reminderId: id,
        message: reminder.text,
        autoReturnMs: Number(input.durationMs || 5000),
        returnTo: input.returnTo || "idle"
      });
      emitter.emit("reminder", { ...reminder });
    }, Math.max(0, dueAtMs - now));

    reminders.set(id, { ...reminder, timeout });
    return reminder;
  }

  function listReminders() {
    return [...reminders.values()].map(({ timeout, ...reminder }) => reminder);
  }

  return {
    emitter,
    snapshot,
    setState,
    createReminder,
    listReminders
  };
}

function createCompanionServer(config, publicConfig) {
  const store = createStateStore(config);
  const sseClients = new Set();
  const assetRoot = config.spine.assetDir ? path.resolve(config.spine.assetDir) : "";

  function broadcastSse(event, value) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const res of sseClients) res.write(payload);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "OPTIONS") {
        sendText(res, 204, "");
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, state: store.snapshot() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/config") {
        sendJson(res, 200, publicConfig());
        return;
      }

      if (req.method === "GET" && url.pathname === "/state") {
        sendJson(res, 200, store.snapshot());
        return;
      }

      if (req.method === "POST" && url.pathname === "/state") {
        sendJson(res, 200, store.setState(await readBody(req)));
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/state/")) {
        const body = await readBody(req);
        body.state = decodeURIComponent(url.pathname.slice("/state/".length));
        sendJson(res, 200, store.setState(body));
        return;
      }

      if (req.method === "GET" && url.pathname === "/reminders") {
        sendJson(res, 200, { reminders: store.listReminders() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/reminders") {
        sendJson(res, 201, store.createReminder(await readBody(req)));
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
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
        if (!assetRoot) {
          sendText(res, 404, "No Spine assetDir is configured.");
          return;
        }
        const relative = decodeURIComponent(url.pathname.slice("/assets/spine/".length));
        const file = path.resolve(assetRoot, relative);
        if (!isInside(assetRoot, file) && file !== assetRoot) {
          sendText(res, 403, "Forbidden");
          return;
        }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          sendText(res, 404, "Asset not found");
          return;
        }
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": contentType(file)
        });
        fs.createReadStream(file).pipe(res);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
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
    }
  };
}

module.exports = {
  createCompanionServer,
  normalizeStateId
};
