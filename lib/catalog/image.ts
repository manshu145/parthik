import { getClientEnv } from '@/lib/config/env';

/**
 * Resolving stored image keys to URLs.
 *
 * The database stores R2 object KEYS, never URLs (`product_images.storage_key`,
 * `categories.image_key`). Keeping keys means the delivery mechanism can change —
 * bucket, custom domain, transformation service — without rewriting rows.
 *
 * ⚠️ DECISION D-07a IS STILL OPEN: Cloudflare Images versus a custom loader has
 * not been chosen. So this deliberately does NOT invent a URL shape. Until a
 * public base URL is configured it returns `null`, and the UI renders its
 * placeholder. A guessed URL would produce broken images in the preview and, worse,
 * would quietly bake an unapproved decision into every call site.
 */

export interface ResolvedImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * True when image delivery is configured.
 *
 * Read through validated config rather than `process.env` so an empty string is
 * treated as unset, like every other value.
 */
export function isImageDeliveryConfigured(): boolean {
  return Boolean(getClientEnv().NEXT_PUBLIC_ASSET_BASE_URL);
}

/**
 * Builds a public URL for a stored object key.
 *
 * Returns null when delivery is unconfigured, or when the key is absent — the two
 * cases the UI must handle identically.
 */
export function imageUrlForKey(storageKey: string | null | undefined): string | null {
  if (!storageKey) return null;

  const base = getClientEnv().NEXT_PUBLIC_ASSET_BASE_URL;
  if (!base) return null;

  // Guard against a key that already looks absolute: re-prefixing it would produce
  // a URL that 404s in a way that is tedious to trace.
  if (/^https?:\/\//i.test(storageKey)) return storageKey;

  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedKey = storageKey.replace(/^\/+/, '');

  return `${trimmedBase}/${trimmedKey}`;
}

/**
 * Resolves an image for rendering, or null when there is nothing to render.
 *
 * `alt` is required by the accessibility rule (master spec §26) and is stored
 * alongside the key, so it is never derived from a filename here.
 */
export function resolveImage(input: {
  storageKey: string | null | undefined;
  altText: string | null | undefined;
  width?: number | null;
  height?: number | null;
}): ResolvedImage | null {
  const url = imageUrlForKey(input.storageKey);
  if (!url) return null;

  return {
    url,
    alt: input.altText ?? '',
    width: input.width ?? null,
    height: input.height ?? null,
  };
}
