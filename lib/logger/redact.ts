/**
 * Log redaction (docs/ARCHITECTURE.md §11.8, docs/SECURITY.md §9.4).
 *
 * Never logged: OTP codes, session tokens, Firebase tokens, password hashes,
 * card data, provider secrets, bank account numbers, full addresses.
 *
 * This is a denylist on key names, applied recursively. A denylist is the wrong
 * default in general, but here it is paired with a unit test asserting that all
 * known-sensitive keys are stripped, and with the rule that log call sites pass
 * explicit context rather than whole entities.
 */

const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /otp/i,
  /(^|_)code$/i,
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /session[_-]?id/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /credential/i,
  /card[_-]?(number|cvv|cvc)/i,
  /cvv/i,
  /cvc/i,
  /account[_-]?number/i,
  /ifsc/i,
  /aadhaar/i,
  /^pan$/i,
  /signature/i,
  /id[_-]?token/i,
  /refresh[_-]?token/i,
];

/** Keys whose value is a full postal address; logged only as a coarse marker. */
const ADDRESS_KEY_PATTERNS: RegExp[] = [
  /^line1$/i,
  /^line2$/i,
  /^address$/i,
  /^full[_-]?address$/i,
];

export const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isAddressKey(key: string): boolean {
  return ADDRESS_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively redacts sensitive values. Depth-limited so a cyclic or absurdly
 * nested object cannot stall the logger — logging must never be the thing that
 * takes down a request.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(source)) {
      if (isSensitiveKey(key)) {
        result[key] = REDACTED;
      } else if (isAddressKey(key)) {
        result[key] = '[ADDRESS_OMITTED]';
      } else {
        result[key] = redact(entry, depth + 1);
      }
    }

    return result;
  }

  return value;
}
