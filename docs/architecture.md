# Architecture

[English](architecture.md) | [简体中文](architecture.zh-CN.md)

```mermaid
flowchart LR
  Codex["Codex / git / tests / calendar"] --> Bridge["optional status bridge"]
  MCP["optional MCP tools"] --> Bridge
  Json["local JSON"] --> Providers
  Http["local HTTP"] --> Providers
  Ws["WebSocket"] --> Providers
  Bridge --> Http
  Bridge --> Ws
  Providers["renderer provider layer"] --> State["state machine"]
  State --> Spine["Pixi Spine runtime"]
  Spine --> Window["transparent desktop window"]
```

The desktop app keeps high-frame animation local. External systems publish status
or events through JSON, HTTP, WebSocket, or an optional MCP bridge; the renderer
translates those states into Spine runtime animation transitions.

MCP is intentionally not in the rendering path. It is better suited for exposing
current task data and events, while the desktop runtime and Pixi own the
transparent window, input handling, and frame loop.
