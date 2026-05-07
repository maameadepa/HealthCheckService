// src/logger.js
//
// Centralized Pino logger. Pretty-printed in development, raw JSON in production.
// JSON logs are essential for log aggregation systems (ELK, Loki, Datadog).

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // In dev, use pino-pretty for human-readable colored output.
  // In prod, emit raw JSON for log aggregators to parse.
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});