import { ProviderError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getGoogleAccessToken } from '@/lib/google/access-token';
import { getFirebaseServerConfigOrNull } from './config';

/**
 * Push notification channel via Firebase Cloud Messaging (decision D-26).
 *
 * Implements the FCM HTTP v1 API directly. `firebase-admin` is unusable on
 * Workers, and the v1 API is a plain authenticated POST, so no SDK is needed.
 *
 * The `PushSender` interface is what the notification service will depend on, so
 * business modules never import FCM types. Swapping provider means adding an
 * adapter here.
 *
 * Context worth remembering: with email (D-25) and non-OTP SMS (D-34) both
 * blocked, push is one of only two outbound channels in V1. A failed send is
 * therefore a real customer-visible event, not a cosmetic one.
 */

export interface PushMessage {
  /** FCM registration token for a single device (devices.fcm_token). */
  token: string;
  title: string;
  body: string;
  /** Deep link opened when the notification is tapped. */
  link?: string;
  /** Small string payload; never include PII (docs/SECURITY.md §9.4). */
  data?: Record<string, string>;
}

export interface PushSendResult {
  success: boolean;
  messageId?: string;
  /** True when FCM reports the token is dead and it should be pruned. */
  tokenInvalid: boolean;
  error?: string;
}

export interface PushSender {
  isConfigured(): boolean;
  send(message: PushMessage): Promise<PushSendResult>;
}

class FcmPushSender implements PushSender {
  isConfigured(): boolean {
    return getFirebaseServerConfigOrNull() !== null;
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    const config = getFirebaseServerConfigOrNull();
    if (!config) {
      // Degrade rather than crash: the caller records a failed notification.
      logger.warn('Push send skipped — FCM is not configured');
      return { success: false, tokenInvalid: false, error: 'not_configured' };
    }

    const accessToken = await getGoogleAccessToken([
      'https://www.googleapis.com/auth/firebase.messaging',
    ]);

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            ...(message.data ? { data: message.data } : {}),
            webpush: {
              fcmOptions: message.link ? { link: message.link } : undefined,
              notification: { icon: '/icons/icon-192.png' },
            },
          },
        }),
      }
    );

    if (response.ok) {
      const payload = (await response.json()) as { name?: string };
      return {
        success: true,
        ...(payload.name ? { messageId: payload.name } : {}),
        tokenInvalid: false,
      };
    }

    // 404 UNREGISTERED / 400 INVALID_ARGUMENT mean the token is dead and must be
    // pruned, so it is distinguished from a transient failure worth retrying.
    const tokenInvalid = response.status === 404 || response.status === 400;

    logger.warn('FCM send failed', { status: response.status, tokenInvalid });

    if (response.status >= 500) {
      throw new ProviderError('fcm', `FCM unavailable (${response.status})`);
    }

    return { success: false, tokenInvalid, error: `http_${response.status}` };
  }
}

export const pushSender: PushSender = new FcmPushSender();
