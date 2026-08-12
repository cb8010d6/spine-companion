export const KNOWN_SOURCES = [
  { id: "codex", label: "Codex", patterns: [/^codex(?:-|$)/i] },
  { id: "claude", label: "Claude", patterns: [/^claude(?:-|$)/i] },
  { id: "cursor", label: "Cursor", patterns: [/^cursor(?:-|$)/i] },
  { id: "vscode", label: "VS Code", patterns: [/^vscode(?:-|$)/i, /^vs-code(?:-|$)/i, /^visual-studio-code(?:-|$)/i] },
  { id: "cline", label: "Cline", patterns: [/^cline(?:-|$)/i] },
  { id: "roo", label: "Roo", patterns: [/^roo(?:-|$)/i] },
  { id: "gemini", label: "Gemini", patterns: [/^gemini(?:-|$)/i] },
  { id: "antigravity", label: "Antigravity", patterns: [/^antigravity(?:-|$)/i] },
  { id: "opencode", label: "OpenCode", patterns: [/^opencode(?:-|$)/i, /^open-code(?:-|$)/i] },
  { id: "mimocode", label: "MiMoCode", patterns: [/^mimocode(?:-|$)/i, /^mimo(?:-|$)/i] },
  { id: "kimi", label: "Kimi", patterns: [/^kimi(?:-|$)/i, /^moonshot(?:-|$)/i] },
  { id: "windsurf", label: "Windsurf", patterns: [/^windsurf(?:-|$)/i] },
  { id: "continue", label: "Continue", patterns: [/^continue(?:-|$)/i] },
  { id: "zed", label: "Zed", patterns: [/^zed(?:-|$)/i] },
  { id: "aider", label: "Aider", patterns: [/^aider(?:-|$)/i] },
  { id: "goose", label: "Goose", patterns: [/^goose(?:-|$)/i] },
  { id: "local-ai", label: "Local AI", patterns: [/^local-ai(?:-|$)/i] }
];

export const GENERIC_AI_PATTERNS = [
  /(?:^|-)mcp$/i,
  /(?:^|-)agent(?:-|$)/i,
  /(?:^|-)assistant(?:-|$)/i,
  /(?:^|-)code(?:-|$)/i,
  /(?:^|-)ai(?:-|$)/i,
  /(?:^|-)llm(?:-|$)/i
];

export function normalizeSource(source) {
  return String(source || "").trim().toLowerCase();
}

export function knownSource(source) {
  const normalized = normalizeSource(source);
  return KNOWN_SOURCES.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized))) || null;
}

export function isAiSource(source) {
  const normalized = normalizeSource(source);
  if (!normalized) return false;
  if (knownSource(normalized)) return true;
  return GENERIC_AI_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function titleCaseSource(source) {
  return String(source || "")
    .replace(/(?:^|[-_\s]+)([a-z0-9])/gi, (_match, char) => ` ${String(char).toUpperCase()}`)
    .replace(/\bMcp\b/g, "MCP")
    .replace(/\bAi\b/g, "AI")
    .replace(/\bLlm\b/g, "LLM")
    .trim();
}

export function sourceDisplayName(source, explicitLabel) {
  if (explicitLabel && String(explicitLabel).trim()) return String(explicitLabel).trim();
  const normalized = normalizeSource(source);
  const known = knownSource(normalized);
  if (known) return known.label;
  if (isAiSource(normalized)) return titleCaseSource(normalized.replace(/(?:-|_)?mcp$/i, "")) || "AI";
  return source ? String(source) : "Local";
}

export function sourceFromClientInfo(clientInfo = {}) {
  const name = String(clientInfo.name || "").trim();
  if (!name) return "";
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const known = knownSource(normalized);
  return known ? `${known.id}-mcp` : `${normalized || "ai"}-mcp`;
}

export default {
  GENERIC_AI_PATTERNS,
  KNOWN_SOURCES,
  isAiSource,
  knownSource,
  normalizeSource,
  sourceDisplayName,
  sourceFromClientInfo,
  titleCaseSource
};
