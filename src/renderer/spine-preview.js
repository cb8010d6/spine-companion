import * as PIXI from "pixi.js";
import { Spine } from "pixi-spine";

function loadSpine(url) {
  return new Promise((resolve, reject) => {
    const loader = new PIXI.Loader();
    loader.add("preview", url);
    loader.onError.add((error) => reject(error));
    loader.load((_loader, resources) => {
      const resource = resources.preview;
      if (!resource?.spineData) {
        reject(new Error("Spine preview data was not found."));
        return;
      }
      resolve(resource.spineData);
    });
  });
}

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

export async function renderSpinePreview(container, preview, options = {}) {
  if (!container || !preview?.spinePreviewUrl) return "";
  const width = Number(options.width || container.clientWidth || 100);
  const height = Number(options.height || container.clientHeight || 100);
  const app = new PIXI.Application({
    width,
    height,
    antialias: true,
    autoStart: false,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  });
  try {
    const spineData = await loadSpine(preview.spinePreviewUrl);
    const spine = new Spine(spineData);
    spine.autoUpdate = false;
    spine.skeleton.setToSetupPose();
    const animation = pickAnimation(spine);
    if (animation) {
      spine.state.setAnimation(0, animation, true);
      spine.state.update(0.12);
      spine.state.apply(spine.skeleton);
    }
    spine.skeleton.updateWorldTransform();
    spine.update(0);
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
    return dataUrl;
  } catch (error) {
    const message = error?.message || String(error || "Unable to render Spine preview.");
    container.title = `Preview unavailable: ${message}`;
    container.setAttribute("aria-label", `${container.getAttribute("aria-label") || "Preview"} (${message})`);
    return "";
  } finally {
    app.destroy(true, { children: true, texture: false, baseTexture: false });
  }
}
