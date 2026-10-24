import { getServerEnv } from '@/lib/config/env';
import { getGoogleAccessToken } from '@/lib/google/access-token';
import type { LogLevel } from '@/lib/logger';

/**
 * Google Cloud Logging sink (decision D-27).
 *
 * Workers do not write to Cloud Logging natively. Two paths are supported:
 *
 *   1. PRIMARY — structured JSON to stdout, collected by Workers observability
 *      and forwarded by a tail-consumer Worker. This is the default, costs
 *      nothing per request, and adds no latency.
 *
 *   2. DIRECT — this module, posting entries to the Cloud Logging API. Intended
 *      for the tail consumer itself, or for a small number of high-value events
 *      that must not wait for shipping (security events, payment anomalies).
 *
 * Deliberately NOT used on the hot request path: an HTTP call per log line would
 * add latency and cost to every request.
 *
 * Known gap (D-27a): this covers server-side logging. Source-mapped BROWSER
 * stack traces are not provided by Cloud Monitoring, and Crashlytics does not
 * cover web. Client errors are forwarded to /api/v1/client-errors without
 * symbolication until that decision is resolved.
 */

const LOGGING_ENDPOINT = 'https://logging.googleapis.com/v2/entries:write';

const SEVERITY: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

export interface CloudLogEntry {
  level: LogLevel;
  message: string;
  payload?: Record<string, unknown>;
  /** Populates Cloud Logging's trace field for request correlation. */
  requestId?: string;
}

export interface LogSink {
  isConfigured(): boolean;
  write(entries: CloudLogEntry[]): Promise<void>;
}

class GoogleCloudLoggingSink implements LogSink {
  isConfigured(): boolean {
    return Boolean(getServerEnv().GCP_PROJECT_ID);
  }

  async write(entries: CloudLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const env = getServerEnv();
    const projectId = env.GCP_PROJECT_ID;

    if (!projectId) {
      // Degrade to stdout so nothing is lost when GCP is not configured.
      for (const entry of entries) {
        console.log(JSON.stringify({ severity: SEVERITY[entry.level], ...entry }));
      }
      return;
    }

    const accessToken = await getGoogleAccessToken([
      'https://www.googleapis.com/auth/logging.write',
    ]);

    const response = await fetch(LOGGING_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        logName: `projects/${projectId}/logs/${env.GCP_LOG_NAME}`,
        resource: { type: 'global' },
        entries: entries.map((entry) => ({
          severity: SEVERITY[entry.level],
          jsonPayload: { message: entry.message, ...entry.payload },
          ...(entry.requestId ? { trace: `projects/${projectId}/traces/${entry.requestId}` } : {}),
        })),
      }),
    });

    if (!response.ok) {
      // Logging failures must never propagate into request handling.
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          message: 'Cloud Logging write failed',
          status: response.status,
        })
      );
    }
  }
}

export const cloudLoggingSink: LogSink = new GoogleCloudLoggingSink();
