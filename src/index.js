import { loadConfig } from './config.js';
import { startChecker } from './checker.js';
import { createServer } from './server.js';
import { logger } from './logger.js';

async function main() {
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

  const stopChecker = startChecker({
    endpoints: config.endpoints,
    intervalMs: config.intervalMs,
  });

  const app = createServer(config);
  const server = app.listen(config.port, () => {
    logger.info(`Listening on port ${config.port}`);
  });

  // handle Ctrl+C and docker/container stop signals
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutdown initiated');

    stopChecker();

    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Error during server close');
        process.exit(1);
      }
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // force quit if it's taking too long
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