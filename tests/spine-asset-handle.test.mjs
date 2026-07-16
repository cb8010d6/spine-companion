import { describe, expect, it, vi } from "vitest";
import { SpineAssetRegistry } from "../src/renderer/spine-asset-handle.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function texture(baseTexture) {
  return { baseTexture, destroy: vi.fn() };
}

function fakePixi() {
  const fallbackBase = { destroy: vi.fn() };
  const fallbackTexture = texture(fallbackBase);
  const TextureCache = { fallback: fallbackTexture };
  const BaseTextureCache = { fallback: fallbackBase };
  return {
    Texture: {
      EMPTY: fallbackTexture,
      WHITE: fallbackTexture,
      removeFromCache: vi.fn((key) => {
        const value = TextureCache[key] || null;
        delete TextureCache[key];
        return value;
      })
    },
    BaseTexture: {
      removeFromCache: vi.fn((key) => {
        const value = BaseTextureCache[key] || null;
        delete BaseTextureCache[key];
        return value;
      })
    },
    utils: { TextureCache, BaseTextureCache },
    fallbackBase,
    fallbackTexture
  };
}

function loadedAsset(pixi) {
  const baseTexture = { destroy: vi.fn() };
  const pageTexture = texture(baseTexture);
  const regionTexture = texture(baseTexture);
  const fallbackRegion = texture(pixi.fallbackBase);
  const spineData = { dispose: vi.fn() };
  const atlas = {
    pages: [{ baseTexture }, { baseTexture: pixi.fallbackBase }],
    regions: [{ texture: regionTexture }, { texture: fallbackRegion }]
  };
  const resource = { spineData, spineAtlas: atlas };
  const loader = {
    resources: {
      model: resource,
      atlasPage: { texture: pageTexture },
      fallbackPage: { texture: pixi.fallbackTexture }
    },
    destroy: vi.fn()
  };
  return { atlas, baseTexture, fallbackRegion, loader, pageTexture, regionTexture, resource, spineData };
}

function cacheAsset(pixi, asset) {
  pixi.utils.TextureCache.page = asset.pageTexture;
  pixi.utils.TextureCache.region = asset.regionTexture;
  pixi.utils.BaseTextureCache.page = asset.baseTexture;
}

describe("Spine asset handles", () => {
  it("returns caches and references to baseline after 100 sequential model swaps", async () => {
    const pixi = fakePixi();
    const registry = new SpineAssetRegistry({
      pixi,
      loadAsset: async (_identity, context) => {
        const asset = loadedAsset(pixi);
        context.setLoader(asset.loader);
        cacheAsset(pixi, asset);
        return { loader: asset.loader, resources: asset.loader.resources, resource: asset.resource };
      }
    });
    for (let index = 0; index < 100; index += 1) {
      const handle = registry.acquire(`http://assets/model-${index}.skel`);
      await handle.load();
      handle.release();
    }
    expect(registry.stats()).toMatchObject({ entries: 0, refs: 0, loadsSucceeded: 100, cleanups: 100 });
    expect(Object.keys(pixi.utils.TextureCache)).toEqual(["fallback"]);
    expect(Object.keys(pixi.utils.BaseTextureCache)).toEqual(["fallback"]);
  });

  it("deduplicates loads and cleans owned atlas resources after the final release", async () => {
    const pixi = fakePixi();
    const asset = loadedAsset(pixi);
    const loadAsset = vi.fn(async () => {
      cacheAsset(pixi, asset);
      return {
        loader: asset.loader,
        resources: asset.loader.resources,
        resource: asset.resource
      };
    });
    const registry = new SpineAssetRegistry({ pixi, loadAsset });
    const first = registry.acquire("http://assets/model.skel");
    const second = registry.acquire("http://assets/model.skel");

    const [firstResource, secondResource] = await Promise.all([first.load(), second.load()]);
    expect(firstResource).toBe(asset.resource);
    expect(secondResource).toBe(asset.resource);
    expect(loadAsset).toHaveBeenCalledTimes(1);
    expect(registry.stats()).toMatchObject({ entries: 1, refs: 2, ready: 1 });

    first.release();
    expect(asset.loader.destroy).not.toHaveBeenCalled();
    expect(asset.baseTexture.destroy).not.toHaveBeenCalled();

    second.release();
    expect(asset.pageTexture.destroy).toHaveBeenCalledWith(false);
    expect(asset.regionTexture.destroy).toHaveBeenCalledWith(false);
    expect(asset.baseTexture.destroy).toHaveBeenCalledTimes(1);
    expect(asset.spineData.dispose).toHaveBeenCalledTimes(1);
    expect(asset.loader.destroy).toHaveBeenCalledTimes(1);
    expect(pixi.utils.TextureCache.page).toBeUndefined();
    expect(pixi.utils.BaseTextureCache.page).toBeUndefined();
    expect(pixi.fallbackTexture.destroy).not.toHaveBeenCalled();
    expect(pixi.fallbackBase.destroy).not.toHaveBeenCalled();
    expect(asset.fallbackRegion.destroy).not.toHaveBeenCalled();
    expect(pixi.utils.TextureCache.fallback).toBe(pixi.fallbackTexture);
    expect(registry.stats()).toMatchObject({ entries: 0, refs: 0, cleanups: 1 });
  });

  it("cancels a released handle while disposing a load that finishes unreferenced", async () => {
    const pixi = fakePixi();
    const pending = deferred();
    const asset = loadedAsset(pixi);
    const registry = new SpineAssetRegistry({ pixi, loadAsset: () => pending.promise });
    const handle = registry.acquire("http://assets/cancelled.skel");
    const load = handle.load();

    handle.release();
    await expect(load).rejects.toMatchObject({ name: "AbortError", code: "SPINE_ASSET_CANCELLED" });
    expect(registry.stats()).toMatchObject({ entries: 1, refs: 0, loading: 1 });

    cacheAsset(pixi, asset);
    pending.resolve({ loader: asset.loader, resources: asset.loader.resources, resource: asset.resource });
    await pending.promise;
    await vi.waitFor(() => expect(asset.loader.destroy).toHaveBeenCalledTimes(1));
    expect(registry.stats()).toMatchObject({ entries: 0, refs: 0, cleanups: 1 });
  });

  it("cleans partial loader resources after failure and permits a fresh acquire", async () => {
    const pixi = fakePixi();
    const firstAsset = loadedAsset(pixi);
    const secondAsset = loadedAsset(pixi);
    const failure = new Error("atlas page failed");
    const loadAsset = vi.fn(async (_identity, context) => {
      if (loadAsset.mock.calls.length === 1) {
        cacheAsset(pixi, firstAsset);
        context.setLoader(firstAsset.loader);
        throw failure;
      }
      cacheAsset(pixi, secondAsset);
      return {
        loader: secondAsset.loader,
        resources: secondAsset.loader.resources,
        resource: secondAsset.resource
      };
    });
    const registry = new SpineAssetRegistry({ pixi, loadAsset });
    const failed = registry.acquire("http://assets/retry.skel");

    await expect(failed.load()).rejects.toBe(failure);
    expect(firstAsset.loader.destroy).toHaveBeenCalledTimes(1);
    expect(firstAsset.pageTexture.destroy).toHaveBeenCalledWith(false);
    expect(firstAsset.baseTexture.destroy).toHaveBeenCalledTimes(1);
    expect(registry.stats()).toMatchObject({ entries: 0, loadsFailed: 1, cleanups: 1 });

    const retry = registry.acquire("http://assets/retry.skel");
    await expect(retry.load()).resolves.toBe(secondAsset.resource);
    expect(loadAsset).toHaveBeenCalledTimes(2);
    failed.release();
    retry.release();
  });
});
