import * as PIXI from "pixi.js";
import { Spine } from "pixi-spine";
import { animationForState, stateMachine } from "./state.js";

export class SpinePlayer {
  constructor(stage, config) {
    this.stageElement = stage;
    this.config = config;
    this.app = null;
    this.model = null;
    this.spine = null;
    this.currentKey = "";
    this.baseScale = 1;
    this.userScale = 1;
    this.direction = "right";
    this.returnTimer = null;
    this.stableBounds = null;
    this.fitBounds = null;
  }

  async init() {
    this.app = new PIXI.Application({
      resizeTo: this.stageElement,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    this.stageElement.appendChild(this.app.view);
    this.model = new PIXI.Container();
    this.app.stage.addChild(this.model);

    await this.loadSpine();
    window.addEventListener("resize", () => this.layout());
    this.stageElement.addEventListener("wheel", (event) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.05 : 0.05;
      this.setUserScale(Math.min(1.7, Math.max(0.55, this.userScale + delta)));
    }, { passive: false });
  }

  async loadSpine() {
    if (!this.config.spine.assetDirConfigured) {
      throw new Error("No Spine asset directory is configured.");
    }

    const resource = await new Promise((resolve, reject) => {
      const loader = new PIXI.Loader();
      loader.add("companion", this.config.spine.assetUrl);
      loader.onError.add((error) => reject(error));
      loader.load((_loader, resources) => {
        if (!resources.companion?.spineData) {
          reject(new Error("Spine data was not found in the loaded asset."));
          return;
        }
        resolve(resources.companion);
      });
    });

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

  setUserScale(scale) {
    this.userScale = scale;
    this.layout();
  }

  applyState(state, force = false) {
    if (!this.spine) return;

    const motion = animationForState(state, this.config);
    const segment = motion.segment ? this.config.specialSegments?.[motion.segment] : null;
    const nextDirection = motion.state === "running" ? (state.direction || "right") : "right";
    const segmentKey = segment ? `${segment.from || 0}-${segment.to || "end"}` : "full";
    const key = `${motion.animation}:${segmentKey}:${segment?.loop ?? motion.loop ?? true}:${nextDirection}`;

    this.direction = nextDirection;
    if (!force && key === this.currentKey) return;
    this.currentKey = key;

    window.clearTimeout(this.returnTimer);
    const entry = this.spine.state.setAnimation(0, motion.animation, segment?.loop ?? motion.loop ?? true);
    entry.mixDuration = Number(this.config.spine.mixDurationMs || 280) / 1000;

    if (segment) {
      entry.animationStart = Number(segment.from || 0);
      entry.animationEnd = Number(segment.to || entry.animation.duration);
      entry.trackTime = 0;
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

  layout() {
    if (!this.app || !this.spine) return;

    const width = this.app.renderer.width / this.app.renderer.resolution;
    const height = this.app.renderer.height / this.app.renderer.resolution;
    const fitBounds = this.fitBounds || this.stableBounds || this.spine.getLocalBounds();
    const padding = Math.max(1, Number(this.config.spine.framePadding || 1.12));
    const availableWidth = Math.max(1, width * 0.86);
    const bottomInset = Number(this.config.spine.stageBottomInset || 0);
    const usableHeight = Math.max(1, height - bottomInset);
    const availableHeight = Math.max(1, usableHeight * 0.94);
    const fitScale = Math.min(availableWidth / (fitBounds.width * padding), availableHeight / (fitBounds.height * padding));
    const configuredScale = Number(this.config.spine.scale || 1);
    const scale = fitScale * configuredScale * this.userScale;
    const mirror = this.direction === "left" ? -1 : 1;

    this.model.scale.set(scale * mirror, scale);
    this.model.x = width / 2 + Number(this.config.spine.offsetX || 0);
    this.model.y = usableHeight * 0.96 + Number(this.config.spine.offsetY || 0);
  }

  destroy() {
    window.clearTimeout(this.returnTimer);
    if (this.app) this.app.destroy(true, { children: true, texture: false, baseTexture: false });
  }
}
