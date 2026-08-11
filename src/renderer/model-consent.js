function text(value, fallback = "") {
  return String(value || fallback).trim();
}

export function modelRequiresAcknowledgement(model = {}) {
  return text(model.license).toUpperCase() === "NOASSERTION"
    || Boolean(text(model.licenseWarning));
}

export function modelRevision(model = {}) {
  const explicit = text(model.revision || model.sourceRevision || model.provenance?.revision);
  if (explicit) return explicit;
  const candidates = [model.repositoryUrl, ...(model.files || []).flatMap((file) => [file?.url, ...(file?.fallbackUrls || [])])];
  for (const candidate of candidates) {
    const value = text(candidate);
    const match = value.match(/(?:\/tree\/|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/|@)([0-9a-f]{40})(?:\/|$)/i);
    if (match) return match[1].toLowerCase();
  }
  return "";
}

export function modelRepository(model = {}) {
  const value = text(model.repositoryUrl);
  if (!value) return "";
  const github = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/.*)?$/i);
  return github ? `https://github.com/${github[1]}` : value;
}

function acknowledgementDetail(model = {}) {
  return {
    source: text(model.source || model.catalogSourceId || model.sourceId, "Unknown source"),
    author: text(model.author, "Unknown"),
    license: text(model.license, "NOASSERTION"),
    licenseWarning: text(model.licenseWarning, "None provided"),
    licenseNote: text(model.licenseNote),
    repository: modelRepository(model) || "Unknown",
    revision: modelRevision(model) || "Unknown"
  };
}

function detailKey(detail) {
  return JSON.stringify([
    detail.source,
    detail.author,
    detail.license,
    detail.licenseWarning,
    detail.licenseNote,
    detail.repository,
    detail.revision
  ]);
}

export function acknowledgementDetails(models = []) {
  const unique = new Map();
  for (const model of models || []) {
    if (!modelRequiresAcknowledgement(model)) continue;
    const detail = acknowledgementDetail(model);
    unique.set(detailKey(detail), detail);
  }
  return [...unique.values()];
}

export function createModelAcknowledgementSession() {
  const accepted = new Set();
  return {
    pending(models = []) {
      return acknowledgementDetails(models).filter((detail) => !accepted.has(detailKey(detail)));
    },
    accept(models = []) {
      for (const detail of acknowledgementDetails(models)) accepted.add(detailKey(detail));
    },
    acceptDetails(details = []) {
      for (const detail of details) accepted.add(detailKey(detail));
    }
  };
}

export function createModelAcknowledgementCoordinator(session = createModelAcknowledgementSession()) {
  let inFlight = null;
  const request = async (models = [], confirm) => {
    const pending = session.pending(models);
    if (!pending.length) return true;
    if (inFlight) {
      const accepted = await inFlight;
      return accepted ? request(models, confirm) : false;
    }

    const prompt = Promise.resolve(confirm(pending, models));
    inFlight = prompt;
    let accepted = false;
    try {
      accepted = Boolean(await prompt);
      if (accepted) session.acceptDetails(pending);
    } finally {
      if (inFlight === prompt) inFlight = null;
    }
    return accepted ? request(models, confirm) : false;
  };
  return { request };
}
