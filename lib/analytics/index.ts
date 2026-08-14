import { getClientEnv, getServerEnv } from '@/lib/config/env';
import { logger } from '@/lib/logger';
import {
  GA4_EVENT_NAMES,
  sanitiseProperties,
  type AnalyticsEvent,
  type AnalyticsProperties,
} from './events';

/**
 * Analytics tracker (decision D-28: Firebase Analytics + GA4).
 *
 * Call sites use `track()` and never touch a provider SDK, so the provider stays
 * swappable and the PII rules are enforced in one place.
 *
 * IMPORTANT (docs/ARCHITECTURE.md §11.7): GA4 is NOT the source of business
 * truth. Admin KPIs — GMV, AOV, cancellation rate, refund value — are computed
 * from PostgreSQL, which is authoritative, unsampled and reconcilable with
 * payments. GA4 is for marketing attribution and behavioural funnels only.
 */

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

export interface TrackOptions {
  /** Pseudonymous client id (GA4 `client_id`). Never a phone number or email. */
  clientId: string;
  /** Optional pseudonymous user id for cross-device stitching. */
  userId?: string;
}

export interface AnalyticsTracker {
  isConfigured(): boolean;
  track(
    event: AnalyticsEvent,
    properties: AnalyticsProperties,
    options: TrackOptions
  ): Promise<void>;
}

/**
 * Server-side GA4 via the Measurement Protocol. Used for commercial events that
 * must not be lost to a client-side blocker.
 */
class Ga4MeasurementProtocolTracker implements AnalyticsTracker {
  isConfigured(): boolean {
    const measurementId = getClientEnv().NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    const apiSecret = getServerEnv().GA4_API_SECRET;
    return Boolean(measurementId && apiSecret);
  }

  async track(
    event: AnalyticsEvent,
    properties: AnalyticsProperties,
    options: TrackOptions
  ): Promise<void> {
    const measurementId = getClientEnv().NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    const apiSecret = getServerEnv().GA4_API_SECRET;

    if (!measurementId || !apiSecret) {
      // Analytics is never allowed to break a business flow. Missing config is
      // logged at debug and the call becomes a no-op.
      logger.debug('Analytics event dropped — GA4 is not configured', { event });
      return;
    }

    const url = new URL(GA4_ENDPOINT);
    url.searchParams.set('measurement_id', measurementId);
    url.searchParams.set('api_secret', apiSecret);

    const payload = {
      client_id: options.clientId,
      ...(options.userId ? { user_id: options.userId } : {}),
      non_personalized_ads: true,
      events: [
        {
          name: GA4_EVENT_NAMES[event],
          params: sanitiseProperties(properties),
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        logger.warn('GA4 Measurement Protocol rejected an event', {
          event,
          status: response.status,
        });
      }
    } catch (error) {
      // Swallow: losing an analytics event must never fail an order.
      logger.warn('GA4 Measurement Protocol request failed', {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const analytics: AnalyticsTracker = new Ga4MeasurementProtocolTracker();

export { ANALYTICS_EVENTS, SERVER_SIDE_EVENTS } from './events';
export type { AnalyticsEvent, AnalyticsProperties } from './events';
