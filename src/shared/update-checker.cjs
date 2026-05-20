function compareVersions(a, b) {
  const left = String(a || "0").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const right = String(b || "0").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function normalizeAsset(asset = {}) {
  return {
    name: String(asset.name || ""),
    url: String(asset.browser_download_url || asset.url || ""),
    size: Number(asset.size || 0),
    digest: asset.digest || ""
  };
}

function assetScore(asset, platform = process.platform, arch = process.arch) {
  const name = String(asset.name || "").toLowerCase();
  const isArm = arch === "arm64" || arch === "aarch64";
  const isX64 = arch === "x64" || arch === "amd64" || arch === "x86_64";

  if (platform === "win32") {
    if (!name.endsWith(".exe") && !name.endsWith(".msi")) return 0;
    let score = name.endsWith(".exe") ? 80 : 60;
    if (isX64 && (name.includes("x64") || name.includes("amd64"))) score += 30;
    if (isArm && (name.includes("arm64") || name.includes("aarch64"))) score += 30;
    return score;
  }

  if (platform === "darwin") {
    if (!name.endsWith(".dmg") && !name.endsWith(".zip")) return 0;
    let score = name.endsWith(".dmg") ? 80 : 45;
    if (isArm && (name.includes("aarch64") || name.includes("arm64"))) score += 35;
    if (isX64 && (name.includes("x64") || name.includes("x86_64") || name.includes("amd64"))) score += 35;
    return score;
  }

  if (platform === "linux") {
    if (!name.endsWith(".appimage") && !name.endsWith(".deb")) return 0;
    let score = name.endsWith(".appimage") ? 80 : 55;
    if (isX64 && (name.includes("x64") || name.includes("amd64") || name.includes("x86_64"))) score += 30;
    if (isArm && (name.includes("aarch64") || name.includes("arm64"))) score += 30;
    return score;
  }

  return 0;
}

function selectReleaseAsset(assets = [], platform = process.platform, arch = process.arch) {
  return assets
    .map(normalizeAsset)
    .map((asset) => ({ asset, score: assetScore(asset, platform, arch) }))
    .filter((item) => item.asset.url && item.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name))[0]?.asset || null;
}

async function checkGitHubRelease({
  fetchImpl = fetch,
  owner = "cb8010d6",
  repo = "spine-companion",
  currentVersion,
  platform = process.platform,
  arch = process.arch
}) {
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { "Accept": "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`GitHub release check failed: HTTP ${response.status}`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || "").replace(/^v/, "");
  const assets = Array.isArray(release.assets) ? release.assets.map(normalizeAsset) : [];
  const recommendedAsset = selectReleaseAsset(assets, platform, arch);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    url: release.html_url,
    name: release.name || release.tag_name,
    assets,
    recommendedAsset,
    downloadUrl: recommendedAsset?.url || release.html_url
  };
}

module.exports = {
  compareVersions,
  selectReleaseAsset,
  checkGitHubRelease
};
