/**
 * Application error taxonomy (docs/ARCHITECTURE.md §6.4).
 *
 * Every error carries:
 *   - a stable machine-readable `code` the client may branch on
 *   - an HTTP `status`
 *   - a `publicMessage` that is safe to display
 *
 * Internal detail stays in `cause`/`context` for logging and is never returned
 * to the caller. That separation is the whole point of this file: it makes
 * "leaks internals to the user" a thing you have to do deliberately.
 */

export type ErrorCode =
  // validation / input
  | 'VALIDATION_FAILED'
  // auth
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'FIREBASE_TOKEN_INVALID'
  | 'FIREBASE_TOKEN_EXPIRED'
  | 'FIREBASE_PROVIDER_NOT_ALLOWED'
  | 'PHONE_CLAIM_MISSING'
  | 'ACCOUNT_SUSPENDED'
  // authorization
  | 'FORBIDDEN'
  | 'PERMISSION_REQUIRED'
  // resources
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATUS_TRANSITION'
  // business rules
  | 'BUSINESS_RULE_VIOLATED'
  /**
   * Cart and commerce codes (docs/API_SPEC.md §5).
   *
   * Named individually rather than collapsed into BUSINESS_RULE_VIOLATED because
   * the client must react differently to each: "only 3 left" needs a quantity
   * adjustment, "items from another store" needs a choice, and a price change needs
   * a confirmation. One generic code would force the UI to parse messages.
   */
  | 'CART_EMPTY'
  | 'PRODUCT_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'QUANTITY_INVALID'
  | 'QUANTITY_LIMIT_EXCEEDED'
  | 'MIXED_VENDOR_CART'
  | 'PRICE_CHANGED'
  | 'STOCK_RESERVATION_FAILED'
  | 'STORE_NOT_ACCEPTING_ORDERS'
  | 'MIN_ORDER_NOT_MET'
  | 'NOT_SERVICEABLE'
  // coupons (docs/API_SPEC.md §5, master spec §18)
  | 'COUPON_NOT_FOUND'
  | 'COUPON_EXPIRED'
  | 'COUPON_INACTIVE'
  | 'COUPON_MIN_CART_NOT_MET'
  | 'COUPON_USAGE_LIMIT_REACHED'
  | 'COUPON_USER_LIMIT_REACHED'
  | 'COUPON_NOT_APPLICABLE'
  | 'COUPON_FIRST_ORDER_ONLY'
  | 'COUPON_ZONE_RESTRICTED'
  /**
   * Payment codes (docs/API_SPEC.md §11).
   *
   * `WEBHOOK_SIGNATURE_INVALID` is separate from `UNAUTHENTICATED` on purpose: one is a
   * customer who needs to sign in, the other is an unsigned or forged provider callback,
   * and a burst of the second is an attack signal rather than a login problem
   * (docs/SECURITY.md §8.2).
   */
  | 'PAYMENT_FAILED'
  | 'PAYMENT_ALREADY_CAPTURED'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'REFUND_EXCEEDS_PAYMENT'
  /**
   * COD and cash-custody codes (docs/API_SPEC.md §11, §6.2).
   *
   * Named individually because each has a different remedy: a zone limit needs a
   * different payment method, a driver over their cash limit needs to deposit, and an
   * amount mismatch needs a variance recorded rather than a refused delivery.
   */
  | 'COD_NOT_AVAILABLE_IN_ZONE'
  | 'COD_NOT_AVAILABLE_FOR_STORE'
  | 'COD_LIMIT_EXCEEDED'
  | 'COD_AMOUNT_MISMATCH'
  | 'DRIVER_CASH_LIMIT_EXCEEDED'
  | 'DEPOSIT_ALREADY_VERIFIED'
  | 'DEPOSIT_AMOUNT_INVALID'
  // infrastructure
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONFIGURATION_ERROR'
  | 'MAINTENANCE_MODE'
  | 'INTERNAL_ERROR';

export interface AppErrorOptions {
  publicMessage?: string;
  context?: Record<string, unknown>;
  /**
   * Machine-readable facts the CLIENT needs, returned in the response
   * (docs/API_SPEC.md §1.3).
   *
   * Distinct from `context` on purpose, and the distinction is the point:
   * `context` is for logs and may hold anything, `details` crosses the network.
   * Put a shortfall amount here; never an internal id, query or provider payload.
   */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;

  /** Safe to show a user. Subclasses provide a sensible default. */
  readonly publicMessage: string;
  readonly context: Record<string, unknown> | undefined;
  /** Safe to return to the caller. See `AppErrorOptions.details`. */
  readonly details: Record<string, unknown> | undefined;

  /**
   * Expected errors (validation, permission, business rules) are logged at
   * warn; unexpected ones at error. Keeps real incidents visible.
   */
  readonly expected: boolean = true;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.publicMessage = options.publicMessage ?? message;
    this.context = options.context;
    this.details = options.details;
  }

  /** Client-facing shape. Deliberately excludes `message` and `context`. */
  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.publicMessage,
      // Omitted entirely when absent, so the envelope stays clean.
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_FAILED' as const;
  readonly status = 422;
  /** Field-level errors, shaped for form rendering. */
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message = 'The submitted data is invalid.',
    fieldErrors: Record<string, string[]> = {},
    options: AppErrorOptions = {}
  ) {
    super(message, { publicMessage: message, ...options });
    this.fieldErrors = fieldErrors;
  }

  override toJSON() {
    return { ...super.toJSON(), fieldErrors: this.fieldErrors };
  }
}

export class AuthenticationError extends AppError {
  readonly code: ErrorCode;
  readonly status = 401;

  constructor(
    code: ErrorCode = 'UNAUTHENTICATED',
    message = 'Please sign in to continue.',
    options: AppErrorOptions = {}
  ) {
    super(message, { publicMessage: message, ...options });
    this.code = code;
  }
}

export class AuthorizationError extends AppError {
  readonly code: ErrorCode;
  readonly status = 403;

  constructor(
    code: ErrorCode = 'FORBIDDEN',
    message = 'You do not have permission to do that.',
    options: AppErrorOptions = {}
  ) {
    super(message, { publicMessage: message, ...options });
    this.code = code;
  }
}

/**
 * Also used to hide existence from unauthorized callers: returning 404 instead
 * of 403 prevents id enumeration (docs/SECURITY.md §5.4).
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly status = 404;

  constructor(message = 'Not found.', options: AppErrorOptions = {}) {
    super(message, { publicMessage: message, ...options });
  }
}

export class ConflictError extends AppError {
  readonly code: ErrorCode;
  readonly status = 409;

  constructor(
    message = 'That conflicts with the current state.',
    code: ErrorCode = 'CONFLICT',
    options: AppErrorOptions = {}
  ) {
    super(message, { publicMessage: message, ...options });
    this.code = code;
  }
}

export class StateTransitionError extends ConflictError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, 'INVALID_STATUS_TRANSITION', options);
  }
}

export class BusinessRuleError extends AppError {
  readonly code: ErrorCode;
  readonly status = 400;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { publicMessage: message, ...options });
    this.code = code;
  }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 60, options: AppErrorOptions = {}) {
    super('Too many requests.', {
      publicMessage: 'Too many attempts. Please try again shortly.',
      ...options,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** An upstream provider failed. Never exposes provider detail to the client. */
export class ProviderError extends AppError {
  readonly code = 'PROVIDER_UNAVAILABLE' as const;
  readonly status = 502;
  override readonly expected = false;
  readonly provider: string;

  constructor(provider: string, message: string, options: AppErrorOptions = {}) {
    super(`[${provider}] ${message}`, {
      publicMessage: 'A required service is temporarily unavailable. Please try again.',
      ...options,
    });
    this.provider = provider;
  }
}

/**
 * Configuration is missing or invalid — for example a provider was used while
 * its credentials are absent. This is the error that makes "fails safely
 * without credentials" observable rather than a mystery crash.
 */
export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION_ERROR' as const;
  readonly status = 503;
  override readonly expected = false;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      publicMessage: 'This feature is not available in this environment.',
      ...options,
    });
  }
}

export class MaintenanceModeError extends AppError {
  readonly code = 'MAINTENANCE_MODE' as const;
  readonly status = 503;

  constructor(message = 'Parthik is briefly unavailable for maintenance.') {
    super(message, { publicMessage: message });
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR' as const;
  readonly status = 500;
  override readonly expected = false;

  constructor(message = 'Unexpected internal error.', options: AppErrorOptions = {}) {
    super(message, {
      publicMessage: 'Something went wrong on our side. Please try again.',
      ...options,
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalises anything thrown into an AppError so handlers stay simple. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof Error) {
    return new InternalError(error.message, { cause: error });
  }
  return new InternalError('Non-error value thrown', { context: { thrown: String(error) } });
}
