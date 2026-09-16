import { serve } from "@hono/node-server";
import { configFromEnvironment } from "./config.js";
import { createMyaiApp } from "./app.js";

const config = configFromEnvironment();
const application = createMyaiApp(config);
const server = serve({ fetch: application.fetch, hostname: config.host, port: config.port });

console.log(`myai server listening on http://${config.host}:${config.port}`);

const shutdown = () => {
  application.close();
  server.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
