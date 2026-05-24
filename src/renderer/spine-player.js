import * as PIXI from "pixi.js";
import { Spine } from "pixi-spine";
import { animationForState, stateMachine } from "./state.js";
import { spineAssetUrl } from "../shared/asset-url.js";

export class SpinePlayer {
  constructor(stage, config) {
    this.stageElement = stage;
    this.config = config;
    this.app = null;
    this.model = null;
    this.spine = null;
    this.currentKey = "";
    this.currentMotionKey = "";
    this.baseScale = 1;
    this.userScale = 1;
    this.direction = "right";
    this.hudVisible = config.ui?.hudVisible !== false;
    this.returnTimer = null;
    this.stableBounds = null;
    this.fitBounds = null;
    this.screenScale = 1;
    this.anchor = { x: 20, y: 28, scale: 1 };
    this.anchorTarget = null;
    this.dragMode = config.ui?.dragMode || "compatible";
    this.dragActive = false;
    this.minUserScale = 0.35;
    this.maxUserScale = 1.55;
    this.baseFitScale = null;
    this.lastLayoutSize = { width: 0, height: 0 };
    this.resizeTimer = null;
    this.handleResize = null;
    this.handleWheel = null;
    this.hitboxPadding = Number.isFinite(Number(config.ui?.hitboxPadding))
      ? Math.min(48, Math.max(0, Number(config.ui.hitboxPadding)))
      : 8;
  }

  async init() {
    const dprLimit = Number.isFinite(Number(this.config.ui?.maxDevicePixelRatio))
      ? Math.min(3, Math.max(1, Number(this.config.ui.maxDevicePixelRatio)))
      : 2;
    this.app = new PIXI.Application({
      resizeTo: this.stageElement,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, dprLimit)
    });
    this.stageElement.appendChild(this.app.view);
    this.model = new PIXI.Container();
    this.app.stage.addChild(this.model);

    await this.loadSpine();
    this.handleResize = () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.layout({ forceFitRecalc: true }), 90);
    };
    this.handleWheel = (event) => {
      event.preventDefault();
      this.adjustUserScale(event.deltaY > 0 ? -0.05 : 0.05);
    };
    window.addEventListener("resize", this.handleResize);
    this.stageElement.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  async loadSpine() {
    if (!this.config.spine.assetDirConfigured) {
      throw new Error("No Spine asset directory is configured.");
    }

    const resource = await this.loadSpineResourceWithRetry();

    this.spine = new Spine(resource.spineData);
    this.spine.autoUpdate = true;
    this.model.addChild(this.spine);

    const animations = this.spine.spineData.animations.map((animation) => animation.name);
    for (const from of animations) {
      for (const to of animations) {
        this.spine.stateData.setMix(from, to, Number(this.config.spine.mixDurationMs || 280) / 1000);
      }
    }

    this.stableBounds = this.measureStableBounds(stateMachine.states);
    this.fitBounds = this.measureStableBounds(this.config.spine.fitStates || stateMachine.states);
    this.applyState({ state: "idle", source: "system" }, true);
  }

  loadSpineResource() {
    return new Promise((resolve, reject) => {
      const loader = new PIXI.Loader();
      loader.add("companion", spineAssetUrl(this.config));
      loader.onError.add((error) => reject(error));
      loader.load((_loader, resources) => {
        if (!resources.companion?.spineData) {
          reject(new Error("Spine data was not found in the loaded asset."));
          return;
        }
        resolve(resources.companion);
      });
    });
  }

  async loadSpineResourceWithRetry() {
    const attempts = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.loadSpineResource();
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 350));
        }
      }
    }
    throw lastError;
  }

  setUserScale(scale) {
    const nextScale = Number(scale);
    this.userScale = Number.isFinite(nextScale)
      ? Math.min(this.maxUserScale, Math.max(this.minUserScale, nextScale))
      : 1;
    this.layout();
  }

  adjustUserScale(delta) {
    const nextDelta = Number(delta);
    if (!Number.isFinite(nextDelta)) return;
    this.setUserScale(this.userScale + nextDelta);
  }

  resetUserScale() {
    this.setUserScale(1);
  }

  setHudVisible(visible) {
    this.hudVisible = Boolean(visible);
    this.layout();
  }

  setDragMode(mode) {
    this.dragMode = mode === "smooth" ? "smooth" : "compatible";
    this.applyTickerMode();
  }

  setHitboxPadding(value) {
    this.hitboxPadding = Number.isFinite(Number(value))
      ? Math.min(48, Math.max(0, Number(value)))
      : 8;
  }

  setDragActive(active) {
    this.dragActive = Boolean(active);
    this.applyTickerMode();
  }

  applyTickerMode() {
    if (!this.app) return;
    this.app.ticker.maxFPS = this.dragActive && this.dragMode !== "smooth" ? 42 : 0;
  }

  setDirection(direction) {
    this.direction = direction === "left" ? "left" : "right";
    this.layout();
  }

  applyState(state, force = false) {
    if (!this.spine) return;

    let motion = animationForState(state, this.config);
    if (motion.state === "running") {
      motion = state?.source === "drag"
        ? { ...motion, animation: "Move", loop: true, segment: null, tailSegment: null, repeatSegment: false }
        : { ...motion, animation: "Relax", loop: true, segment: null, tailSegment: null, repeatSegment: false };
    }
    const segment = motion.segment ? this.config.specialSegments?.[motion.segment] : null;
    const tailSegment = motion.tailSegment ? this.config.specialSegments?.[motion.tailSegment] : null;
    const nextDirection = motion.state === "running" ? (state.direction || "right") : "right";
    const segmentKey = segment ? `${segment.from || 0}-${segment.to || "end"}` : "full";
    const tailKey = tailSegment ? `>${tailSegment.from || 0}-${tailSegment.to || "end"}:${tailSegment.loop ?? true}` : "";
    const motionKey = `${motion.animation}:${segmentKey}:${segment?.loop ?? motion.loop ?? true}${tailKey}`;
    const key = `${motionKey}:${nextDirection}`;

    this.direction = nextDirection;
    if (!force && key === this.currentKey) return;
    if (!force && motionKey === this.currentMotionKey) {
      this.currentKey = key;
      this.layout();
      return;
    }
    this.currentKey = key;
    this.currentMotionKey = motionKey;

    window.clearTimeout(this.returnTimer);
    const entry = this.spine.state.setAnimation(0, motion.animation, segment?.loop ?? motion.loop ?? true);
    entry.mixDuration = Number(this.config.spine.mixDurationMs || 280) / 1000;

    if (segment) {
      entry.animationStart = Number(segment.from || 0);
      entry.animationEnd = Number(segment.to || entry.animation.duration);
      entry.trackTime = 0;
    }

    if (tailSegment && !(segment?.loop ?? motion.loop ?? true)) {
      const tailShouldRepeat = tailSegment.loop !== false;
      const tailRepeatCount = tailShouldRepeat ? Math.max(1, Number(tailSegment.repeatCount || 240)) : 1;
      const tailMixDuration = Number(tailSegment.mixDurationMs || this.config.spine.mixDurationMs || 280) / 1000;
      for (let index = 0; index < tailRepeatCount; index += 1) {
        const tailEntry = this.spine.state.addAnimation(0, motion.animation, !tailShouldRepeat && (tailSegment.loop ?? false), 0);
        tailEntry.mixDuration = tailMixDuration;
        tailEntry.animationStart = Number(tailSegment.from || 0);
        tailEntry.animationEnd = Number(tailSegment.to || tailEntry.animation.duration);
        tailEntry.trackTime = 0;
      }
    }

    if (motion.repeatSegment && segment && !(segment.loop ?? motion.loop ?? true)) {
      const repeatCount = Math.max(1, Number(motion.repeatCount || 480));
      const mixDuration = Number(motion.repeatMixDurationMs || this.config.spine.mixDurationMs || 280) / 1000;
      for (let index = 0; index < repeatCount; index += 1) {
        const repeatEntry = this.spine.state.addAnimation(0, motion.animation, false, 0);
        repeatEntry.mixDuration = mixDuration;
        repeatEntry.animationStart = Number(segment.from || 0);
        repeatEntry.animationEnd = Number(segment.to || repeatEntry.animation.duration);
        repeatEntry.trackTime = 0;
      }
    }

    if (motion.returnTo && motion.returnAfterMs && !force) {
      this.returnTimer = window.setTimeout(() => {
        this.onAutoReturn?.(motion.returnTo);
      }, Number(motion.returnAfterMs));
    }

    this.applyStableAnchor();
    this.layout();
  }

  measureStableBounds(stateIds) {
    if (!this.spine) return;
    const sampleCount = Math.max(3, Number(this.config.spine.boundsSamples || 10));
    const animations = new Map(this.spine.spineData.animations.map((animation) => [animation.name, animation]));
    const measured = [];
    const originalAutoUpdate = this.spine.autoUpdate;
    this.spine.autoUpdate = false;
    this.spine.position.set(0, 0);
    this.spine.scale.set(1, 1);

    for (const stateId of stateIds) {
      const motion = animationForState({ state: stateId }, this.config);
      const animation = animations.get(motion.animation);
      if (!animation) continue;
      const segment = motion.segment ? this.config.specialSegments?.[motion.segment] : null;
      const from = Number(segment?.from ?? 0);
      const to = Number(segment?.to ?? animation.duration ?? 1);
      const span = Math.max(0.001, to - from);

      for (let index = 0; index < sampleCount; index += 1) {
        const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
        this.sampleAnimationBounds(motion.animation, from + span * ratio, Boolean(segment?.loop ?? motion.loop ?? true), measured);
      }
    }

    this.spine.autoUpdate = originalAutoUpdate;
    if (measured.length === 0) return null;

    const union = measured.reduce((acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.x),
      minY: Math.min(acc.minY, bounds.y),
      maxX: Math.max(acc.maxX, bounds.x + bounds.width),
      maxY: Math.max(acc.maxY, bounds.y + bounds.height)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    return {
      x: union.minX,
      y: union.minY,
      width: union.maxX - union.minX,
      height: union.maxY - union.minY
    };
  }

  sampleAnimationBounds(animation, time, loop, measured) {
    this.spine.skeleton.setToSetupPose();
    this.spine.state.clearTracks();
    this.spine.state.setAnimation(0, animation, loop);
    this.spine.state.update(time);
    this.spine.state.apply(this.spine.skeleton);
    this.spine.skeleton.updateWorldTransform();
    this.spine.update(0);
    const bounds = this.spine.getLocalBounds();
    if (Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 1 && bounds.height > 1) {
      measured.push({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    }
  }

  applyStableAnchor() {
    if (!this.spine) return;
    const bounds = this.stableBounds || this.spine.getLocalBounds();
    this.spine.x = -(bounds.x + bounds.width / 2);
    this.spine.y = -(bounds.y + bounds.height);
  }

  layout(options = {}) {
    if (!this.app || !this.spine) return;

    const width = this.stageElement.clientWidth || this.app.renderer.width / this.app.renderer.resolution;
    const height = this.stageElement.clientHeight || this.app.renderer.height / this.app.renderer.resolution;
    if (width < 120 || height < 160) return;
    const fitBounds = this.fitBounds || this.stableBounds || this.spine.getLocalBounds();
    const boundsWidth = Math.max(80, Number(fitBounds.width || 0));
    const boundsHeight = Math.max(120, Number(fitBounds.height || 0));
    const padding = Math.max(1, Number(this.config.spine.framePadding || 1.12));
    const availableWidth = Math.max(1, width * 0.86);
    const bottomInset = this.hudVisible ? Number(this.config.spine.stageBottomInset || 0) : 0;
    const usableHeight = Math.max(1, height - bottomInset);
    const availableHeight = Math.max(1, usableHeight * 0.94);
    const measuredFitScale = Math.min(availableWidth / (boundsWidth * padding), availableHeight / (boundsHeight * padding));
    const sizeChanged = Math.abs(width - this.lastLayoutSize.width) > 8 || Math.abs(height - this.lastLayoutSize.height) > 8;
    if (!this.baseFitScale || options.forceFitRecalc || sizeChanged) {
      this.baseFitScale = measuredFitScale;
      this.lastLayoutSize = { width, height };
    }
    const fitScale = Math.min(measuredFitScale, this.baseFitScale * 1.08);
    const configuredScale = Number(this.config.spine.scale || 1);
    const rawScale = fitScale * configuredScale * this.userScale;
    const fill = Math.max(0.45, Math.min(0.9, Number(this.config.spine.maxViewportFill || 0.72)));
    const maxScaleByHeight = (height * fill) / boundsHeight;
    const maxScaleByWidth = (width * 0.86) / boundsWidth;
    const scale = Math.max(0.01, Math.min(rawScale, maxScaleByHeight, maxScaleByWidth));
    const mirror = this.direction === "left" ? -1 : 1;

    this.screenScale = scale;
    this.model.scale.set(scale * mirror, scale);
    this.model.x = width / 2 + Number(this.config.spine.offsetX || 0);
    this.model.y = usableHeight * 0.96 + Number(this.config.spine.offsetY || 0);
    this.updateAnchor(width, height);
  }

  updateAnchor(stageWidth, stageHeight) {
    if (!this.spine || !this.stableBounds) return;
    const bounds = this.stableBounds;
    const side = this.direction === "left" ? 1 : -1;
    const smallModel = this.userScale < 0.82;
    const tinyModel = this.userScale < 0.68;
    const horizontalFactor = tinyModel ? 1.05 : smallModel ? 0.78 : 0.38;
    const verticalFactor = tinyModel ? 0.78 : smallModel ? 0.84 : 0.8;
    const anchorScale = Math.max(0.62, Math.min(1.08, 0.56 + this.userScale * 0.38));
    const x = this.model.x + side * bounds.width * this.screenScale * horizontalFactor;
    const modelTop = this.model.y - bounds.height * this.screenScale;
    const modelWidth = bounds.width * this.screenScale;
    const modelHeight = bounds.height * this.screenScale;
    const modelShoulder = this.model.y - bounds.height * this.screenScale * verticalFactor;
    const minY = Math.max(10, modelTop + 8 * anchorScale);
    const maxY = Math.max(minY, stageHeight - 86 * anchorScale);
    const target = {
      x: Math.max(12, Math.min(stageWidth - 48, x)),
      y: Math.max(minY, Math.min(maxY, modelShoulder)),
      scale: anchorScale,
      side: this.direction === "left" ? "right" : "left",
      avoid: {
        left: this.model.x - modelWidth * 0.34,
        right: this.model.x + modelWidth * 0.34,
        top: this.model.y - modelHeight * 0.72,
        bottom: this.model.y - modelHeight * 0.06
      }
    };

    const canSmooth = this.anchorTarget
      && this.anchorTarget.side === target.side
      && Math.abs(this.anchorTarget.scale - target.scale) < 0.015;
    if (canSmooth) {
      target.y = Math.max(target.y, this.anchorTarget.y - 22);
    }
    const mix = canSmooth ? 0.42 : 1;
    this.anchor = {
      x: this.anchor.x + (target.x - this.anchor.x) * mix,
      y: this.anchor.y + (target.y - this.anchor.y) * mix,
      scale: target.scale,
      side: target.side,
      avoid: target.avoid
    };
    this.anchorTarget = target;
    this.onAnchorChange?.(this.anchor);
  }

  getAnchor() {
    return { ...this.anchor };
  }

  getInteractiveBounds() {
    if (!this.model || !this.spine) return null;
    const sourceBounds = this.spine.getLocalBounds?.() || this.stableBounds;
    if (!sourceBounds) return null;
    const width = Math.max(1, sourceBounds.width * this.screenScale);
    const height = Math.max(1, sourceBounds.height * this.screenScale);
    const zoomRange = Math.max(0.01, this.maxUserScale - this.minUserScale);
    const zoomRatio = Math.max(0, Math.min(1, (this.userScale - this.minUserScale) / zoomRange));
    const hitWidth = width * (0.16 + zoomRatio * 0.18);
    const hitHeight = height * (0.2 + zoomRatio * 0.18);
    const scaledPadding = Math.min(this.hitboxPadding * 0.65, Math.max(1, this.hitboxPadding * this.userScale * 0.55));
    const bottom = this.model.y - height * 0.04;
    return {
      left: this.model.x - hitWidth / 2 - scaledPadding,
      right: this.model.x + hitWidth / 2 + scaledPadding,
      top: bottom - hitHeight - scaledPadding,
      bottom: bottom + scaledPadding
    };
  }

  destroy() {
    window.clearTimeout(this.returnTimer);
    window.clearTimeout(this.resizeTimer);
    if (this.handleResize) window.removeEventListener("resize", this.handleResize);
    if (this.handleWheel) this.stageElement.removeEventListener("wheel", this.handleWheel);
    if (this.app) this.app.destroy(true, { children: true, texture: false, baseTexture: false });
  }
}
