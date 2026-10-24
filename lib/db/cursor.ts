/**
 * Opaque keyset cursors.
 *
 * Shared so the Drizzle and in-memory repositories cannot drift on cursor format
 * — a fake that paginates differently from the real thing is worse than no fake.
 *
 * THE CURSOR CARRIES ITS SORT KEY. Keyset pagination is only correct when the
 * comparison uses the SAME column the rows are ordered by. Encoding just
 * `(createdAt, id)` while the caller sorts by price silently returns overlapping
 * and missing pages, which looks like flaky data rather than a pagination bug.
 * Recording the key lets a mismatch be detected instead of producing nonsense.
 *
 * Base64url keeps clients from treating the value as meaningful and building a
 * dependency on our sort implementation.
 */

export interface DecodedCursor {
  /** The sort key this cursor was produced for. */
  key: string;
  /** Stringified value of that sort column for the last row of the page. */
  value: string;
  /** Row id, always included as the tie-break. */
  id: string;
}

const SEPARATOR = '|';

export function encodeCursor(key: string, value: string, id: string): string {
  return Buffer.from([key, value, id].join(SEPARATOR)).toString('base64url');
}

/**
 * Decodes a cursor, returning null when it is unusable.
 *
 * Returns null — rather than throwing — when the cursor was issued for a
 * DIFFERENT sort key. That happens routinely when a customer changes the sort
 * while holding a cursor in the URL, and restarting from the first page is the
 * correct, boring outcome.
 */
export function decodeCursor(cursor: string, expectedKey: string): DecodedCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [key, value, id] = decoded.split(SEPARATOR);

    if (!key || !value || !id) return null;
    if (key !== expectedKey) return null;

    return { key, value, id };
  } catch {
    return null;
  }
}
