import { ImageOff } from 'lucide-react';
import { imageUrlForKey } from '@/lib/catalog/image';
import { cn } from '@/lib/utils';

/**
 * Product/category imagery with an honest fallback.
 *
 * Image delivery is unconfigured until decision D-07a picks a loader, and no image
 * fixtures exist, so `imageUrlForKey` returns null and this renders a neutral
 * placeholder. That is deliberate: a guessed URL would show broken-image icons
 * across the preview and bake an unapproved decision into every call site.
 *
 * A plain `<img>` rather than `next/image`: the Next optimizer is a poor fit on
 * Workers and the final loader is exactly what D-07a decides. Swapping this one
 * component later is a smaller change than unwinding `next/image` everywhere.
 */
export function ProductImage({
  storageKey,
  alt,
  placeholderLabel,
  className,
  sizes,
}: {
  storageKey: string | null;
  alt: string | null;
  placeholderLabel: string;
  className?: string;
  sizes?: string;
}) {
  const url = imageUrlForKey(storageKey);

  if (!url) {
    return (
      <div
        // `aria-hidden` plus a visible label: the placeholder carries no
        // information a screen reader needs, and the product name is already
        // announced by the surrounding link.
        aria-hidden="true"
        data-testid="product-image-placeholder"
        className={cn(
          'bg-muted text-muted-foreground flex aspect-square w-full items-center justify-center rounded-[var(--radius-control)]',
          className
        )}
      >
        <span className="flex flex-col items-center gap-1">
          <ImageOff className="size-6" />
          <span className="px-2 text-center text-[0.625rem] leading-tight">{placeholderLabel}</span>
        </span>
      </div>
    );
  }

  return (
    // next/image is deliberately avoided until decision D-07a picks an image
    // loader: the default Next optimizer is a poor fit on Workers (see
    // next.config.ts), and committing to `next/image` now would have to be unwound
    // across every call site. Swapping this one component later is cheaper.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      // Empty alt is valid and correct for decorative product shots whose name is
      // already in the link text; a non-empty value from the DB wins.
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      sizes={sizes}
      className={cn('aspect-square w-full rounded-[var(--radius-control)] object-cover', className)}
    />
  );
}
