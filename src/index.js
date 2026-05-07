// src/index.js
//
// Application entry point. Responsibilities:
//   1. Load and validate config
//   2. Start the background Checker
//   3. Start the HTTP server
//   4. Wire up graceful shutdown on SIGINT / SIGTERM
//
// Graceful shutdown is critical in production: when the orchestrator
// (Kubernetes, Docker, etc.) sends SIGTERM, we have a few seconds to
// finish in-flight work and exit cleanly. Crash-on-shutdown looks
// unprofessional and can corrupt state in real systems.

import { loadConfig } from './config.js';
import { startChecker } from './checker.js';
import { createServer } from './server.js';
import { logger } from './logger.js';

async function main() {
  // 1. Load config — fail fast if anything is wrong.
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.fatal({ err }, 'Configuration error');
    process.exit(1);
  }

  logger.info(
    {
      port: config.port,
      intervalMs: config.intervalMs,
      endpointCount: config.endpoints.length,
    },
    'Starting health-check-service'
  );

  // 2. Start the background checker.
  const stopChecker = startChecker({
    endpoints: config.endpoints,
    intervalMs: config.intervalMs,
  });

  // 3. Start the HTTP server.
  const app = createServer(config);
  const server = app.listen(config.port, () => {
    logger.info(`Listening on port ${config.port}`);
  });

  // 4. Graceful shutdown.
  // SIGTERM is what container orchestrators send to ask a process to stop.
  // SIGINT is what Ctrl+C sends in a terminal. Handle both.
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutdown initiated');

    // Stop the checker first so no new state writes happen.
    stopChecker();

    // Stop accepting new HTTP connections; let in-flight ones finish.
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Error during server close');
        process.exit(1);
      }
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Hard timeout: if shutdown takes more than 10s, force-exit.
    setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error in main');
  process.exit(1);
});