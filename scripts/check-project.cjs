const { loadConfig, getPublicConfig } = require("../src/backend/config.cjs");
const { createCompanionServer } = require("../src/backend/state-server.cjs");

async function main() {
  const config = loadConfig();
  config.server.port = 0;
  const server = createCompanionServer(config, () => getPublicConfig(config, "http://127.0.0.1:0"));
  const address = await server.listen();
  const origin = `http://${address.address}:${address.port}`;

  const health = await fetch(`${origin}/health`);
  if (!health.ok) throw new Error(`Health check failed: HTTP ${health.status}`);

  const updated = await fetch(`${origin}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "working", source: "check" })
  });
  if (!updated.ok) throw new Error(`State update failed: HTTP ${updated.status}`);

  const state = await updated.json();
  if (state.state !== "working") throw new Error(`Expected working state, got ${state.state}`);

  server.close();
  console.log("Project check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
