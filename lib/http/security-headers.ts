/**
 * Security headers (docs/SECURITY.md §9.5).
 *
 * Applied in middleware so every response is covered from one place, including
 * route handlers.
 *
 * CSP note: the allowances below are wider than they would be without Google
 * services — Firebase's reCAPTCHA verifier, the Firebase auth handler domain and
 * the Razorpay checkout all need them. That is the documented cost of the
 * Google-first strategy (docs/ARCHITECTURE.md §16.9).
 *
 * CSP is REPORT-ONLY until it has been observed against real sign-in and
 * checkout traffic. A CSP that breaks checkout is worse than no CSP, so the
 * switch to enforcing mode is a deliberate later step, not a default.
 */

export interface SecurityHeaderOptions {
  /** Firebase auth domain, permitted as a frame source for the auth handler. */
  firebaseAuthDomain?: string | undefined;
  /** Emit enforcing CSP instead of report-only. */
  enforceCsp?: boolean;
  /** Marks private surfaces as non-indexable (docs/ROUTES.md §1). */
  noindex?: boolean;
}

function buildCsp(options: SecurityHeaderOptions): string {
  const firebaseFrame = options.firebaseAuthDomain ? ` https://${options.firebaseAuthDomain}` : '';

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    // 'unsafe-inline' for styles only; Tailwind and Next inject style tags.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google-analytics.com",
    // Google/Firebase SDKs and Razorpay checkout.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com https://apis.google.com https://*.googletagmanager.com https://checkout.razorpay.com",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com https://*.google-analytics.com https://*.analytics.google.com https://*.googleapis.com https://api.razorpay.com",
    `frame-src 'self' https://www.google.com https://checkout.razorpay.com https://api.razorpay.com${firebaseFrame}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions = {}): void {
  const csp = buildCsp(options);

  headers.set(
    options.enforceCsp ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    csp
  );

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // geolocation and camera are needed for location detection and delivery-proof
  // capture; everything else is denied.
  headers.set(
    'Permissions-Policy',
    'geolocation=(self), camera=(self), microphone=(), payment=(self), usb=()'
  );

  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  if (options.noindex) {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
}
