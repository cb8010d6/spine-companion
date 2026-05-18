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

async function checkGitHubRelease({ fetchImpl = fetch, owner = "cb8010d6", repo = "spine-companion", currentVersion }) {
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { "Accept": "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error(`GitHub release check failed: HTTP ${response.status}`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || "").replace(/^v/, "");
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    url: release.html_url,
    name: release.name || release.tag_name
  };
}

module.exports = {
  compareVersions,
  checkGitHubRelease
};
