import { getServerEnv } from '@/lib/config/env';
import { isAppError, toAppError } from '@/lib/errors';
import { redact } from './redact';

/**
 * Structured JSON logger (docs/ARCHITECTURE.md §11.8).
 *
 * Emits one JSON object per line to stdout. On Cloudflare Workers that is
 * collected by Workers observability, and shipped to Google Cloud Logging by a
 * tail consumer (D-27) — so the shape here deliberately matches Cloud Logging's
 * expectations (`severity`, `message`, and an `error` payload that Cloud Error
 * Reporting can group).
 *
 * Mandatory context fields per §11.8: requestId, route, actorId, actorRole,
 * plus domain ids where relevant.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Maps to Cloud Logging severity values. */
const CLOUD_SEVERITY: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

export interface LogContext {
  requestId?: string;
  route?: string;
  method?: string;
  actorId?: string;
  actorRole?: string;
  locale?: string;
  /** Domain correlation ids — §11.8 requires these to be traceable in logs. */
  orderId?: string;
  paymentId?: string;
  deliveryId?: string;
  vendorId?: string;
  driverId?: string;
  jobId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

interface LogEntry extends Record<string, unknown> {
  severity: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

function currentLevel(): LogLevel {
  try {
    return getServerEnv().LOG_LEVEL;
  } catch {
    // Configuration itself may be broken; logging must still work.
    return 'info';
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel()];
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    severity: CLOUD_SEVERITY[level],
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(redact(context) as Record<string, unknown>),
  };

  const line = JSON.stringify(entry);

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Logs a thrown value at the severity its type implies. */
  exception(error: unknown, context?: LogContext): void;
  /** Returns a logger that carries the given context on every call. */
  child(context: LogContext): Logger;
}

function createLogger(base: LogContext = {}): Logger {
  const merge = (context?: LogContext): LogContext => ({ ...base, ...context });

  return {
    debug: (message, context) => write('debug', message, merge(context)),
    info: (message, context) => write('info', message, merge(context)),
    warn: (message, context) => write('warn', message, merge(context)),
    error: (message, context) => write('error', message, merge(context)),

    exception: (error, context) => {
      const appError = toAppError(error);
      // Expected errors (validation, permissions, business rules) are warnings;
      // only genuine faults are errors, so alerting stays meaningful.
      const level: LogLevel = appError.expected ? 'warn' : 'error';

      write(level, appError.message, {
        ...merge(context),
        errorCode: appError.code,
        errorStatus: appError.status,
        errorName: appError.name,
        expected: appError.expected,
        // Cloud Error Reporting groups on a stack trace in this field.
        stack_trace: appError.stack,
        ...(isAppError(error) && error.context ? { errorContext: error.context } : {}),
      });
    },

    child: (context) => createLogger(merge(context)),
  };
}

export const logger: Logger = createLogger();

/** Creates a request-scoped logger. Used by middleware and route handlers. */
export function requestLogger(context: LogContext): Logger {
  return createLogger(context);
}

export { redact } from './redact';
