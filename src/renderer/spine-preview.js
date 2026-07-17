import * as PIXI from "pixi.js";
import { Spine } from "pixi-spine";
import { acquireSpineAsset } from "./spine-asset-handle.js";

const PREVIEW_RENDERER_IDLE_MS = 30000;

let previewApp = null;
let previewQueue = Promise.resolve();
let previewIdleTimer = 0;
let previewRenderCount = 0;

function pickAnimation(spine) {
  const animations = spine.spineData?.animations || [];
  return animations.find((animation) => /idle|relax/i.test(animation.name))?.name
    || animations[0]?.name
    || "";
}

function fitSpineToStage(spine, width, height) {
  const bounds = spine.getLocalBounds();
  const safeWidth = Math.max(1, bounds.width);
  const safeHeight = Math.max(1, bounds.height);
  const scale = Math.min(width / safeWidth, height / safeHeight) * 0.86;
  spine.scale.set(scale);
  spine.x = width / 2 - (bounds.x + bounds.width / 2) * scale;
  spine.y = height / 2 - (bounds.y + bounds.height / 2) * scale;
}

function createPreviewApp(width, height) {
  const app = new PIXI.Application({
    width,
    height,
    antialias: true,
    autoStart: false,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  });
  const interaction = app.renderer?.plugins?.interaction;
  if (interaction) {
    interaction.useSystemTicker = false;
    interaction.removeEvents?.();
  }
  app.stage.interactive = false;
  app.stage.interactiveChildren = false;
  return app;
}

function getPreviewApp(width, height) {
  window.clearTimeout(previewIdleTimer);
  previewIdleTimer = 0;
  previewApp ||= createPreviewApp(width, height);
  previewApp.renderer.resize(width, height);
  return previewApp;
}

export function disposeSpinePreviewRenderer() {
  window.clearTimeout(previewIdleTimer);
  previewIdleTimer = 0;
  if (!previewApp) return;
  const loseContext = previewApp.renderer?.gl?.getExtension?.("WEBGL_lose_context");
  previewApp.destroy(true, { children: true, texture: false, baseTexture: false });
  loseContext?.loseContext?.();
  previewApp = null;
}

function schedulePreviewRendererDisposal() {
  window.clearTimeout(previewIdleTimer);
  previewIdleTimer = window.setTimeout(disposeSpinePreviewRenderer, PREVIEW_RENDERER_IDLE_MS);
}

async function renderQueuedPreview(container, preview, options = {}) {
  if (!container || !preview?.spinePreviewUrl) return "";
  const width = Number(options.width || container.clientWidth || 100);
  const height = Number(options.height || container.clientHeight || 100);
  const app = getPreviewApp(width, height);
  const handle = acquireSpineAsset(preview.spinePreviewUrl, { resourceName: "preview" });
  let spine = null;
  try {
    const resource = await handle.load();
    spine = new Spine(resource.spineData);
    spine.autoUpdate = false;
    spine.skeleton.setToSetupPose();
    const animation = pickAnimation(spine);
    if (animation) spine.state.setAnimation(0, animation, true);
    spine.update(0.12);
    fitSpineToStage(spine, width, height);
    app.stage.addChild(spine);
    app.renderer.render(app.stage);

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    const dataUrl = app.view.toDataURL("image/png");
    image.src = dataUrl;
    container.classList.add("has-image", "has-spine-preview");
    container.prepend(image);
    previewRenderCount += 1;
    return dataUrl;
  } catch (error) {
    const message = error?.message || String(error || "Unable to render Spine preview.");
    container.title = `Preview unavailable: ${message}`;
    container.setAttribute("aria-label", `${container.getAttribute("aria-label") || "Preview"} (${message})`);
    return "";
  } finally {
    if (spine?.parent === app.stage) app.stage.removeChild(spine);
    spine?.destroy?.({ children: true, texture: false, baseTexture: false });
    handle.release();
    app.stage.removeChildren();
    schedulePreviewRendererDisposal();
  }
}

export function renderSpinePreview(container, preview, options = {}) {
  const task = previewQueue.catch(() => {}).then(() => renderQueuedPreview(container, preview, options));
  previewQueue = task;
  return task;
}

export function getSpinePreviewRendererStatsForTests() {
  return { active: Boolean(previewApp), renderCount: previewRenderCount };
}
