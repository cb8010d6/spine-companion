#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  BoundingBoxAttachment,
  ClippingAttachment,
  MeshAttachment,
  PathAttachment,
  PointAttachment,
  RegionAttachment,
  SkeletonBinary
} from "@pixi-spine/runtime-3.8";

const DEFAULT_CATALOGS = [
  ["operators", "catalog/catalog.json"],
  ["illustrations", "catalog/illustrations.json"],
  ["enemies", "catalog/enemies.json"]
];

const attachmentLoader = {
  newRegionAttachment: (_skin, name) => new RegionAttachment(name),
  newMeshAttachment: (_skin, name) => new MeshAttachment(name),
  newBoundingBoxAttachment: (_skin, name) => new BoundingBoxAttachment(name),
  newPathAttachment: (_skin, name) => new PathAttachment(name),
  newPointAttachment: (_skin, name) => new PointAttachment(name),
  newClippingAttachment: (_skin, name) => new ClippingAttachment(name)
};

export function selectEvenSample(items, rate = 0.01) {
  if (!items.length) return [];
  const count = Math.max(1, Math.min(items.length, Math.round(items.length * rate)));
  return Array.from({ length: count }, (_, index) => (
    items[Math.min(items.length - 1, Math.floor((index + 0.5) * items.length / count))]
  ));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function verifyCatalogBytes(file, bytes) {
  if (file.sizeBytes && bytes.length !== file.sizeBytes) {
    throw new Error(`size ${bytes.length}/${file.sizeBytes}`);
  }
  const sha256 = String(file.sha256 || "").toLowerCase();
  if (sha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha256) throw new Error(`SHA-256 ${actual}/${sha256}`);
    return;
  }
  const blobSha = String(file.githubBlobSha || "").toLowerCase();
  if (blobSha) {
    const actual = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (actual !== blobSha) throw new Error(`Git blob SHA ${actual}/${blobSha}`);
  }
}

async function fetchModelBytes(file) {
  const failures = [];
  for (const url of [...(file.fallbackUrls || []), file.url].filter(Boolean)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      verifyCatalogBytes(file, bytes);
      return bytes;
    } catch (error) {
      failures.push(`${new URL(url).hostname}: ${error.message || error}`);
    }
  }
  throw new Error(failures.join("; "));
}

function animationCapabilities(animations) {
  const parts = animations.map((name) => String(name).toLowerCase().split(/[^a-z0-9]+/));
  const has = (...names) => parts.some((tokens) => tokens.some((token) => (
    names.some((name) => token === name || (token.startsWith(name) && /^\d+$/.test(token.slice(name.length))))
  )));
  return {
    idle: has("idle", "default", "relax", "stand"),
    move: has("move", "run", "walk"),
    interact: has("interact", "touch", "tap"),
    sit: has("sit"),
    sleep: has("sleep"),
    special: has("special", "skill", "attack")
  };
}

async function auditModel(kind, model) {
  const file = (model.files || []).find((item) => item.name === model.skel);
  if (!file) throw new Error("catalog does not contain the selected .skel file");
  const bytes = await fetchModelBytes(file);
  const skeleton = new SkeletonBinary(attachmentLoader).readSkeletonData(bytes);
  const animations = skeleton.animations.map((animation) => animation.name);
  return {
    kind,
    id: model.id,
    detectedVersion: skeleton.version,
    declaredVersion: `${model.spine?.min || "?"}..${model.spine?.max || model.spine?.min || "?"}`,
    bytes: bytes.length,
    animationCount: animations.length,
    capabilities: animationCapabilities(animations),
    animations
  };
}

function parseArgs(args) {
  const options = { sampleRate: 0.01, json: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--sample-rate") options.sampleRate = Number(args[++index]);
    else if (args[index] === "--json") options.json = true;
    else if (args[index] === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!Number.isFinite(options.sampleRate) || options.sampleRate <= 0 || options.sampleRate > 1) {
    throw new Error("--sample-rate must be greater than 0 and no greater than 1");
  }
  return options;
}

export function summarizeAudit(records, failures, totals) {
  return Object.fromEntries(DEFAULT_CATALOGS.map(([kind]) => {
    const rows = records.filter((record) => record.kind === kind);
    const counts = rows.map((record) => record.animationCount).sort((left, right) => left - right);
    const versions = {};
    for (const row of rows) versions[row.detectedVersion] = (versions[row.detectedVersion] || 0) + 1;
    return [kind, {
      total: totals[kind] || 0,
      sampled: rows.length,
      failures: failures.filter((failure) => failure.kind === kind).length,
      versions,
      animationCount: counts.length ? {
        min: counts[0],
        median: counts[Math.floor(counts.length / 2)],
        max: counts.at(-1)
      } : null,
      fewest: rows
        .sort((left, right) => left.animationCount - right.animationCount || left.id.localeCompare(right.id))
        .slice(0, 10)
        .map(({ id, animationCount, animations }) => ({ id, animationCount, animations }))
    }];
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: bun scripts/audit-model-catalog.mjs [--sample-rate 0.01] [--json]\n");
    return;
  }
  const jobs = [];
  const totals = {};
  for (const [kind, catalogPath] of DEFAULT_CATALOGS) {
    const catalog = await Bun.file(catalogPath).json();
    totals[kind] = catalog.models?.length || 0;
    for (const model of selectEvenSample(catalog.models || [], options.sampleRate)) jobs.push({ kind, model });
  }
  const audited = await mapWithConcurrency(jobs, 4, async ({ kind, model }) => {
    try {
      return { record: await auditModel(kind, model) };
    } catch (error) {
      return { failure: { kind, id: model.id, error: error.message || String(error) } };
    }
  });
  const records = audited.flatMap((item) => item.record ? [item.record] : []);
  const failures = audited.flatMap((item) => item.failure ? [item.failure] : []);
  const report = {
    sampleRate: options.sampleRate,
    sampled: jobs.length,
    summary: summarizeAudit(records, failures, totals),
    failures,
    models: records
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Audited ${records.length}/${jobs.length} sampled models.\n`);
  for (const [kind, summary] of Object.entries(report.summary)) {
    const versions = Object.entries(summary.versions).map(([version, count]) => `${version}:${count}`).join(", ");
    const counts = summary.animationCount ? `${summary.animationCount.min}/${summary.animationCount.median}/${summary.animationCount.max}` : "n/a";
    process.stdout.write(`${kind}: ${summary.sampled}/${summary.total}, failures=${summary.failures}, versions=${versions || "n/a"}, animations(min/median/max)=${counts}\n`);
    for (const model of summary.fewest) {
      process.stdout.write(`  ${model.id}: ${model.animationCount} [${model.animations.join(", ")}]\n`);
    }
  }
  if (failures.length) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
