import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import type { ProductCardLabels, ProductCardView } from '@/lib/catalog/view';
import { cn } from '@/lib/utils';
import { ProductImage } from './product-image';
import { ProductPrice } from './product-price';

/**
 * Product card.
 *
 * PRESENTATIONAL ONLY. It formats what it is given and never computes a price,
 * discount or stock state — those are server-owned (docs/API_SPEC.md §1.2). There
 * is deliberately no "Add to cart" button: the cart is TASK 008, and a button that
 * silently does nothing is worse than no button.
 *
 * The whole card is one link rather than nested interactive elements, so keyboard
 * users get a single predictable tab stop per product.
 */
export function ProductCard({
  product,
  locale,
  labels,
  className,
}: {
  product: ProductCardView;
  locale: 'en' | 'hi';
  labels: ProductCardLabels;
  className?: string;
}) {
  return (
    <Link
      href={`/products/${product.slug}`}
      data-testid="product-card"
      className={cn(
        'group border-border bg-card relative flex flex-col gap-2 rounded-[var(--radius-card)] border p-2',
        'transition-colors hover:border-[var(--color-primary)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
        className
      )}
    >
      <span className="relative block">
        <ProductImage
          storageKey={product.primaryImageKey}
          alt={product.primaryImageAlt}
          placeholderLabel={labels.imagePlaceholder}
          sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 45vw"
        />

        {product.discountPercent !== null && (
          <Badge variant="success" className="absolute top-1 left-1" data-testid="product-discount">
            {labels.discountBadgeTemplate.replace('{percent}', String(product.discountPercent))}
          </Badge>
        )}

        {!product.inStock && (
          // Stated on the card, not discovered at checkout.
          <span
            className="bg-background/85 absolute inset-0 flex items-center justify-center rounded-[var(--radius-control)]"
            data-testid="product-out-of-stock"
          >
            <Badge variant="danger">{labels.outOfStock}</Badge>
          </span>
        )}
      </span>

      <span className="flex min-h-[2.5rem] flex-col gap-0.5">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{product.name}</span>
        {product.unitLabel && (
          <span className="text-muted-foreground text-xs">{product.unitLabel}</span>
        )}
      </span>

      <ProductPrice
        pricePaise={product.pricePaise}
        mrpPaise={product.mrpPaise}
        discountPercent={product.discountPercent}
        locale={locale}
        mrpLabel={labels.mrpLabel}
        className="mt-auto"
      />
    </Link>
  );
}
