import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpStateProvider, JsonStateProvider, WebSocketStateProvider } from "../src/renderer/providers.js";

describe("state providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("polls HTTP state and posts updates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: "working", source: "test" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: "success" })
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HttpStateProvider("http://127.0.0.1:17388/", 1000);
    const states = [];
    await provider.start((state) => states.push(state));
    const result = await provider.setState({ state: "success" });
    provider.stop();

    expect(states).toEqual([{ state: "working", source: "test" }]);
    expect(result).toEqual({ state: "success" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17388/state", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:17388/state",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reports HTTP polling errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HttpStateProvider("http://127.0.0.1:17388", 1000);
    const errors = [];
    provider.onError = (error) => errors.push(error.message);
    await provider.start(() => {});
    provider.stop();

    expect(provider.consecutiveErrors).toBe(1);
    expect(errors).toEqual(["HTTP 503"]);
  });

  it("polls a JSON source", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "idle" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new JsonStateProvider("/state.json", 1000);
    const states = [];
    await provider.start((state) => states.push(state));
    provider.stop();

    expect(states).toEqual([{ state: "idle" }]);
    expect(fetchMock).toHaveBeenCalledWith("/state.json", { cache: "no-store" });
  });

  it("reports JSON polling errors instead of silently stopping", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new JsonStateProvider("/missing.json", 1000);
    const errors = [];
    provider.onError = (error, context) => errors.push({ message: error.message, count: context.consecutiveErrors });
    await provider.start(() => {});
    provider.stop();

    expect(provider.consecutiveErrors).toBe(1);
    expect(errors).toEqual([{ message: "HTTP 404", count: 1 }]);
  });

  it("lists and deletes HTTP reminders", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reminders: [{ id: "r1" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ deleted: true, id: "r1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new HttpStateProvider("http://127.0.0.1:17388", 1000);
    expect(await provider.listReminders()).toEqual([{ id: "r1" }]);
    expect(await provider.deleteReminder("r1")).toEqual({ deleted: true, id: "r1" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:17388/reminders", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:17388/reminders/r1", { method: "DELETE" });
  });

  it("ignores malformed WebSocket messages", () => {
    let messageHandler = null;
    class FakeWebSocket {
      static OPEN = 1;
      constructor() {
        this.readyState = FakeWebSocket.OPEN;
      }
      addEventListener(type, handler) {
        if (type === "message") messageHandler = handler;
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const provider = new WebSocketStateProvider("ws://127.0.0.1:17388/ws");
    const states = [];
    provider.start((state) => states.push(state));

    expect(() => messageHandler({ data: "{ bad json" })).not.toThrow();
    messageHandler({ data: JSON.stringify({ payload: { state: "working" } }) });
    provider.stop();

    expect(states).toEqual([{ state: "working" }]);
  });
});
