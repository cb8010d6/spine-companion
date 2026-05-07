const { loadConfig, getPublicConfig } = require("../src/main/config.cjs");
const { createCompanionServer } = require("../src/main/state-server.cjs");

async function main() {
  const config = loadConfig();
  const origin = `http://${config.server.host}:${config.server.port}`;
  const server = createCompanionServer(config, () => getPublicConfig(config, origin));
  await server.listen();
  console.log(`Companion API listening on ${origin}`);
  console.log(`Renderer preview URL: http://127.0.0.1:17389?api=${origin}`);

  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
