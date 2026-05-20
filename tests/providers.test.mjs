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
