export class IpcStateProvider {
  constructor() {
    this.unsubscribe = null;
    this.unsubscribeReminders = null;
  }

  async start(onState) {
    if (!window.companion) throw new Error("Desktop companion bridge is not available.");
    this.unsubscribe = window.companion.onState(onState);
    onState(await window.companion.getState());
  }

  stop() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.unsubscribeReminders) this.unsubscribeReminders();
  }

  setState(state) {
    return window.companion.setState(state);
  }

  createReminder(reminder) {
    return window.companion.createReminder(reminder);
  }

  listReminders() {
    return window.companion.listReminders?.() || Promise.resolve([]);
  }

  deleteReminder(id) {
    return window.companion.deleteReminder?.(id);
  }

  onReminders(callback) {
    this.unsubscribeReminders = window.companion.onReminders?.(callback) || null;
    return this.unsubscribeReminders || (() => {});
  }
}

export class HttpStateProvider {
  constructor(baseUrl, pollMs = 1000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.pollMs = pollMs;
    this.timer = null;
    this.onError = null;
    this.consecutiveErrors = 0;
    this.reminderEventSource = null;
    this.reminderPollTimer = null;
  }

  async start(onState) {
    const poll = async () => {
      try {
        const response = await fetch(`${this.baseUrl}/state`, { cache: "no-store" });
        if (response.ok) {
          this.consecutiveErrors = 0;
          onState(await response.json());
        } else {
          this.consecutiveErrors++;
          this.onError?.(new Error(`HTTP ${response.status}`));
        }
      } catch (error) {
        this.consecutiveErrors++;
        this.onError?.(error);
      }
    };
    await poll();
    this.timer = setInterval(() => poll(), this.pollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.reminderPollTimer) clearInterval(this.reminderPollTimer);
    if (this.reminderEventSource) this.reminderEventSource.close();
  }

  async setState(state) {
    const response = await fetch(`${this.baseUrl}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    return response.json();
  }

  async createReminder(reminder) {
    const response = await fetch(`${this.baseUrl}/reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reminder)
    });
    return response.json();
  }

  async listReminders() {
    const response = await fetch(`${this.baseUrl}/reminders`, { cache: "no-store" });
    const body = await response.json();
    return body.reminders || [];
  }

  async deleteReminder(id) {
    const response = await fetch(`${this.baseUrl}/reminders/${encodeURIComponent(id)}`, { method: "DELETE" });
    return response.json();
  }

  onReminders(callback) {
    if (typeof EventSource === "function") {
      this.reminderEventSource = new EventSource(`${this.baseUrl}/events`);
      this.reminderEventSource.addEventListener("reminders", (event) => {
        try {
          callback(JSON.parse(event.data));
        } catch (error) {
          console.warn("Ignoring invalid reminder event", error);
        }
      });
      return () => this.reminderEventSource?.close();
    }
    const poll = async () => callback(await this.listReminders());
    poll().catch((error) => this.onError?.(error, { provider: "http-reminders" }));
    this.reminderPollTimer = setInterval(() => {
      poll().catch((error) => this.onError?.(error, { provider: "http-reminders" }));
    }, Math.max(1000, this.pollMs));
    return () => clearInterval(this.reminderPollTimer);
  }
}

export class JsonStateProvider {
  constructor(url, pollMs = 1000) {
    this.url = url;
    this.pollMs = pollMs;
    this.timer = null;
    this.onError = null;
    this.consecutiveErrors = 0;
  }

  async start(onState) {
    const poll = async () => {
      try {
        const response = await fetch(this.url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.consecutiveErrors = 0;
        onState(await response.json());
      } catch (error) {
        this.consecutiveErrors++;
        this.onError?.(error, { consecutiveErrors: this.consecutiveErrors, provider: "json" });
      }
    };
    await poll();
    this.timer = setInterval(() => {
      poll();
    }, this.pollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

export class WebSocketStateProvider {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.onState = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.maxReconnectDelay = 30000;
    this.destroyed = false;
    this.onRemindersCallback = null;
  }

  start(onState) {
    this.onState = onState;
    this.connect();
  }

  connect() {
    if (this.destroyed) return;
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === "reminders") {
          this.onRemindersCallback?.(parsed.payload || []);
        } else {
          this.onState?.(parsed.payload || parsed);
        }
      } catch (error) {
        console.warn("Ignoring invalid WebSocket state message", error);
      }
    });
    this.socket.addEventListener("close", () => {
      if (this.destroyed) return;
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      // Error is followed by close, reconnect handled there
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  stop() {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.close();
  }

  setState(state) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "state", payload: state }));
    }
  }

  onReminders(callback) {
    this.onRemindersCallback = callback;
    return () => {
      if (this.onRemindersCallback === callback) this.onRemindersCallback = null;
    };
  }
}

export function createStateProvider(config) {
  const search = new URLSearchParams(location.search);
  const providerType = search.get("provider") || (window.companion ? "ipc" : "local-http");
  const pollMs = Number(config.state?.pollMs || 1000);

  if (providerType === "ipc") return new IpcStateProvider();
  if (providerType === "json") return new JsonStateProvider(search.get("source") || "state.json", pollMs);
  if (providerType === "websocket") {
    return new WebSocketStateProvider(search.get("ws") || config.server.websocketUrl);
  }

  const api = search.get("api") || config.server.origin;
  return new HttpStateProvider(api, pollMs);
}

export async function loadRuntimeConfig() {
  if (window.companion) return window.companion.getConfig();

  const search = new URLSearchParams(location.search);
  const api = (search.get("api") || "http://127.0.0.1:17388").replace(/\/$/, "");
  const response = await fetch(`${api}/config`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load companion config from ${api}.`);
  return response.json();
}
