import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const {
  createCompanionServer,
  isLoopbackHost,
  rewriteAtlasTextureUrls
} = require("../src/backend/state-server.cjs");

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null, raw: body });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: null, raw: body });
        }
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function postJson(url, data) {
  return request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

function waitForSseEvent(url, eventName, predicate, action) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const req = http.request(url, { headers: { accept: "text/event-stream" } }, (res) => {
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new Error(`Timed out waiting for ${eventName}`));
      }, 2000);

      Promise.resolve()
        .then(action)
        .catch((error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            req.destroy();
            reject(error);
          }
        });

      res.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const name = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
          if (name !== eventName) continue;
          const data = lines
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice("data: ".length))
            .join("\n");
          const parsed = JSON.parse(data);
          if (predicate(parsed)) {
            settled = true;
            clearTimeout(timeout);
            req.destroy();
            resolve(parsed);
            return;
          }
        }
      });
    });
    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    req.end();
  });
}

function firstWebSocketMessage(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("message", (data) => {
      socket.close();
      resolve(JSON.parse(String(data)));
    });
    socket.once("error", reject);
  });
}

describe("state-server HTTP API", () => {
  let runtime;
  let baseUrl;

  beforeEach(async () => {
    const config = {
      state: { initial: "idle" },
      server: { host: "127.0.0.1", port: 0 },
      spine: { assetDir: "" }
    };
    runtime = createCompanionServer(config, () => ({
      server: { origin: baseUrl },
      spine: { skel: "test.skel" }
    }));
    const address = await runtime.listen();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    runtime.close();
  });

  describe("GET /health", () => {
    it("returns ok with current state", async () => {
      const res = await request(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.state.state).toBe("idle");
    });
  });

  describe("GET /state", () => {
    it("returns the current state", async () => {
      const res = await request(`${baseUrl}/state`);
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("idle");
    });
  });

  describe("POST /state", () => {
    it("updates the state", async () => {
      const res = await postJson(`${baseUrl}/state`, {
        state: "working",
        source: "test"
      });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("working");
      expect(res.body.source).toBe("test");
    });

    it("normalizes aliases", async () => {
      const res = await postJson(`${baseUrl}/state`, { state: "move" });
      expect(res.body.state).toBe("running");
    });

    it("rejects invalid state payloads", async () => {
      const res = await postJson(`${baseUrl}/state`, { autoReturnMs: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid state payload/);
    });
  });

  describe("POST /state/:id", () => {
    it("sets state from URL path", async () => {
      const res = await postJson(`${baseUrl}/state/working`, {
        source: "test"
      });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe("working");
    });
  });

  describe("GET /history", () => {
    it("returns recent state transitions", async () => {
      await postJson(`${baseUrl}/state`, { state: "working", source: "test" });
      const res = await request(`${baseUrl}/history`);
      expect(res.status).toBe(200);
      expect(res.body.history.some((item) => item.state === "working")).toBe(true);
    });
  });

  describe("session lifecycle HTTP API", () => {
    it("lists source/session records without inventing ids", async () => {
      await postJson(`${baseUrl}/state`, {
        state: "working",
        source: "codex-mcp",
        sourceLabel: "Codex",
        sessionId: "build-1",
        eventKind: "report"
      });
      await postJson(`${baseUrl}/state`, {
        state: "running",
        source: "codex-mcp",
        sessionId: "build-2",
        eventKind: "report"
      });
      await postJson(`${baseUrl}/state`, {
        state: "reviewing",
        source: "codex-mcp",
        eventKind: "report"
      });

      const res = await request(`${baseUrl}/sessions`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ focused: null, staleAfterMs: 300000 });
      expect(res.body.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "codex-mcp", sessionId: "build-1", granularity: "session" }),
        expect.objectContaining({ source: "codex-mcp", sessionId: "build-2", granularity: "session" }),
        expect.objectContaining({ source: "codex-mcp", granularity: "source" })
      ]));
    });

    it("focuses a session and returns to automatic focus", async () => {
      await postJson(`${baseUrl}/state`, { state: "working", source: "codex-mcp", sessionId: "build-1", eventKind: "report" });
      const focused = await postJson(`${baseUrl}/sessions/focus`, { source: "codex-mcp", sessionId: "build-1" });
      expect(focused.status).toBe(200);
      expect(focused.body).toMatchObject({ source: "codex-mcp", sessionId: "build-1" });
      expect((await request(`${baseUrl}/sessions`)).body.focused).toEqual({ source: "codex-mcp", sessionId: "build-1" });

      const automatic = await postJson(`${baseUrl}/sessions/focus`, { source: null });
      expect(automatic.status).toBe(200);
      expect((await request(`${baseUrl}/sessions`)).body.focused).toBeNull();
    });

    it("dismisses a temporary display by revision", async () => {
      await postJson(`${baseUrl}/state`, { state: "working", source: "codex-mcp", message: "Build", eventKind: "report" });
      const reminder = await postJson(`${baseUrl}/reminders`, { id: "http-dismiss", text: "Pause", delayMs: 0, durationMs: 60000 });
      expect(reminder.status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const displayed = await request(`${baseUrl}/state`);
      expect(displayed.body.state).toBe("reminder");

      const stale = await postJson(`${baseUrl}/state/dismiss`, { revision: displayed.body.revision - 1 });
      expect(stale.status).toBe(200);
      expect(stale.body.state).toBe("reminder");
      const dismissed = await postJson(`${baseUrl}/state/dismiss`, { revision: displayed.body.revision });
      expect(dismissed.status).toBe(200);
      expect(dismissed.body).toMatchObject({ state: "working", source: "codex-mcp", message: "Build" });
    });
  });

  describe("GET /reminders", () => {
    it("returns empty list initially", async () => {
      const res = await request(`${baseUrl}/reminders`);
      expect(res.status).toBe(200);
      expect(res.body.reminders).toEqual([]);
    });
  });

  describe("POST /reminders", () => {
    it("creates a reminder", async () => {
      const res = await postJson(`${baseUrl}/reminders`, {
        text: "Test reminder",
        inSeconds: 300
      });
      expect(res.status).toBe(201);
      expect(res.body.text).toBe("Test reminder");
      expect(res.body.id).toMatch(/^rem_/);
    });

    it("lists created reminder", async () => {
      await postJson(`${baseUrl}/reminders`, { text: "Listed" });
      const res = await request(`${baseUrl}/reminders`);
      expect(res.body.reminders).toHaveLength(1);
      expect(res.body.reminders[0].text).toBe("Listed");
    });

    it("deletes reminders", async () => {
      const created = await postJson(`${baseUrl}/reminders`, { text: "Delete me", delayMs: 60000 });
      const deleted = await request(`${baseUrl}/reminders/${encodeURIComponent(created.body.id)}`, { method: "DELETE" });
      expect(deleted.status).toBe(200);
      expect(deleted.body.deleted).toBe(true);
      const listed = await request(`${baseUrl}/reminders`);
      expect(listed.body.reminders).toEqual([]);
    });

    it("streams reminder list updates over SSE", async () => {
      const streamed = await waitForSseEvent(
        `${baseUrl}/events`,
        "reminders",
        (items) => items.some((item) => item.text === "Streamed"),
        () => postJson(`${baseUrl}/reminders`, { text: "Streamed", delayMs: 60000 })
      );

      expect(streamed).toHaveLength(1);
      expect(streamed[0].text).toBe("Streamed");
    });
  });

  describe("OPTIONS", () => {
    it("returns 204 for CORS preflight", async () => {
      const res = await request(`${baseUrl}/state`, { method: "OPTIONS" });
      expect(res.status).toBe(204);
    });
  });

  describe("CORS", () => {
    it("allows localhost origins", async () => {
      const res = await request(`${baseUrl}/state`, {
        headers: { origin: "http://127.0.0.1:17389" }
      });
      expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:17389");
    });

    it("blocks non-localhost origins", async () => {
      const res = await request(`${baseUrl}/state`, {
        headers: { origin: "http://evil.com" }
      });
      expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1");
    });
  });

  describe("WebSocket development contract", () => {
    it("keeps /ws available in the JavaScript development API", async () => {
      const message = await firstWebSocketMessage(baseUrl.replace(/^http/, "ws") + "/ws");
      expect(message).toMatchObject({ type: "state", payload: { state: "idle" } });
    });
  });

  describe("404", () => {
    it("returns 404 for unknown paths", async () => {
      const res = await request(`${baseUrl}/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  describe("assets", () => {
    it("returns 404 when assetDir is not configured", async () => {
      const res = await request(`${baseUrl}/assets/spine/test.skel`);
      expect(res.status).toBe(404);
    });

    it("rewrites atlas texture names with URL-sensitive characters", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-assets-"));
      try {
        fs.writeFileSync(
          path.join(dir, "build_char_1001_amiya2_sale#16.atlas"),
          "build_char_1001_amiya2_sale#16.png\nsize: 956,956\nB_HandD_FA\n  rotate: true\n"
        );
        runtime.setAssetRoot(dir);
        const res = await request(`${baseUrl}/assets/spine/build_char_1001_amiya2_sale%2316.atlas`);
        expect(res.status).toBe(200);
        expect(res.raw).toContain("build_char_1001_amiya2_sale%2316.png");
        expect(res.raw).toContain("B_HandD_FA");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("state-server bind contract", () => {
  it.each(["localhost", "127.0.0.1", "127.42.0.7", "::1"])(
    "accepts loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    }
  );

  it.each(["0.0.0.0", "192.168.1.10", "example.com", "127.0.0.1.example.com"])(
    "rejects non-loopback host %s before listen",
    async (host) => {
      const runtime = createCompanionServer(
        {
          state: { initial: "idle" },
          server: { host, port: 0 },
          spine: { assetDir: "" }
        },
        () => ({})
      );

      await expect(runtime.listen()).rejects.toThrow(/loopback/i);
      runtime.store.destroy();
    }
  );
});

describe("rewriteAtlasTextureUrls", () => {
  it("encodes only atlas page texture lines", () => {
    const text = "texture#1.png\nsize: 1,1\nregion#name\n  rotate: false\n";
    expect(rewriteAtlasTextureUrls(text)).toContain("texture%231.png");
    expect(rewriteAtlasTextureUrls(text)).toContain("region#name");
  });
});
