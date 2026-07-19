const GENERIC_INTEGRATION_PATH = "M9.4 3 8.7 5.6c-.5.2-1 .5-1.4.8L4.7 5.7 2.4 9.6l1.9 1.9a8 8 0 0 0 0 1L2.4 14.4l2.3 3.9 2.6-.7c.4.3.9.6 1.4.8l.7 2.6h4.5l.7-2.6c.5-.2 1-.5 1.4-.8l2.6.7 2.3-3.9-1.9-1.9a8 8 0 0 0 0-1l1.9-1.9-2.3-3.9-2.6.7c-.4-.3-.9-.6-1.4-.8L13.9 3zm2.3 5.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2";

// Keep these as local URLs so desktop builds do not depend on vendor CDNs.
const LOCAL_IMAGES = Object.freeze({
  openai: new URL("./assets/integrations/openai.png", import.meta.url).href,
  anthropic: new URL("./assets/integrations/anthropic.svg", import.meta.url).href,
  cursor: new URL("./assets/integrations/cursor.svg", import.meta.url).href,
  vscode: new URL("./assets/integrations/vscode.png", import.meta.url).href,
  gemini: new URL("./assets/integrations/gemini.png", import.meta.url).href,
  antigravity: new URL("./assets/integrations/antigravity.png", import.meta.url).href,
  opencode: new URL("./assets/integrations/opencode.png", import.meta.url).href,
  roo: new URL("./assets/integrations/roo-code.svg", import.meta.url).href,
  cline: new URL("./assets/integrations/cline.svg", import.meta.url).href,
  mimocode: new URL("./assets/integrations/mimocode.svg", import.meta.url).href,
  kimi: new URL("./assets/integrations/kimi.png", import.meta.url).href
});

const ICONS = Object.freeze({
  openai: {
    color: "#10a37f",
    image: LOCAL_IMAGES.openai,
    path: GENERIC_INTEGRATION_PATH
  },
  anthropic: {
    color: "#d97757",
    image: LOCAL_IMAGES.anthropic,
    path: GENERIC_INTEGRATION_PATH
  },
  cursor: {
    color: "#14120b",
    image: LOCAL_IMAGES.cursor,
    path: GENERIC_INTEGRATION_PATH
  },
  vscode: {
    color: "#007acc",
    image: LOCAL_IMAGES.vscode,
    path: GENERIC_INTEGRATION_PATH
  },
  gemini: {
    color: "#1a73e8",
    image: LOCAL_IMAGES.gemini,
    path: GENERIC_INTEGRATION_PATH
  },
  antigravity: {
    color: "#4285f4",
    image: LOCAL_IMAGES.antigravity,
    path: GENERIC_INTEGRATION_PATH
  },
  opencode: {
    color: "#b7b1b1",
    image: LOCAL_IMAGES.opencode,
    path: GENERIC_INTEGRATION_PATH
  },
  roo: {
    color: "#000000",
    image: LOCAL_IMAGES.roo,
    path: GENERIC_INTEGRATION_PATH
  },
  cline: {
    color: "#24292f",
    image: LOCAL_IMAGES.cline,
    path: GENERIC_INTEGRATION_PATH
  },
  mimocode: {
    color: "#ff6900",
    image: LOCAL_IMAGES.mimocode,
    path: GENERIC_INTEGRATION_PATH
  },
  kimi: {
    color: "#111111",
    image: LOCAL_IMAGES.kimi,
    path: GENERIC_INTEGRATION_PATH
  },
  custom: {
    color: "#64748b",
    image: null,
    path: GENERIC_INTEGRATION_PATH
  }
});

const TOOL_ICONS = Object.freeze({
  codex: "openai",
  chatgpt: "openai",
  openai: "openai",
  "openai-codex": "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  "claude-code": "anthropic",
  "claude-desktop": "anthropic",
  cursor: "cursor",
  vscode: "vscode",
  "vs-code": "vscode",
  "visual-studio-code": "vscode",
  gemini: "gemini",
  antigravity: "antigravity",
  "gemini-antigravity": "antigravity",
  "gemini-cli": "gemini",
  opencode: "opencode",
  roo: "roo",
  "roo-code": "roo",
  "roo-cline": "roo",
  cline: "cline",
  mimocode: "mimocode",
  "mimo-code": "mimocode",
  "xiaomi-mimo": "mimocode",
  kimi: "kimi",
  "kimi-code": "kimi",
  "kimi-cli": "kimi",
  moonshot: "kimi",
  custom: "custom"
});

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function localImage(value) {
  const image = nonEmptyString(value);
  if (!image || /^(?:https?:)?\/\//i.test(image)) return null;
  return image;
}

/**
 * Returns presentation metadata for an integration. Full vendor SVGs are kept
 * in local assets for image-capable consumers; the legacy manager only accepts
 * a single 24px path, so it receives the neutral integration fallback path.
 */
export function integrationBrand(id, metadata = {}) {
  const key = TOOL_ICONS[String(id || "").trim().toLowerCase()];
  if (!key) return null;

  const brand = ICONS[key];
  const color = nonEmptyString(metadata?.color) || nonEmptyString(metadata?.brandColor) || brand.color;
  const image = localImage(metadata?.localImage) || localImage(metadata?.image) || brand.image;

  return { key, ...brand, color, image, localImage: image };
}
