import type { ProductCardLabels, ProductCardView } from '@/lib/catalog/view';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ProductCard } from './product-card';

/**
 * Responsive product grid.
 *
 * Two columns on the smallest screens rather than one: a single-column grocery list
 * makes browsing feel endless on a phone, and 2×N matches what customers expect
 * from every comparable app.
 *
 * Rendering an empty grid is not this component's job — the caller shows the
 * appropriate empty state, which needs context this component does not have.
 */
export function ProductGrid({
  products,
  locale,
  labels,
  className,
}: {
  products: ProductCardView[];
  locale: 'en' | 'hi';
  labels: ProductCardLabels;
  className?: string;
}) {
  return (
    <ul
      data-testid="product-grid"
      className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5', className)}
    >
      {products.map((product) => (
        <li key={product.slug} className="flex">
          <ProductCard product={product} locale={locale} labels={labels} className="w-full" />
        </li>
      ))}
    </ul>
  );
}

/** Matches ProductGrid's layout so the page does not reflow when data arrives. */
export function ProductGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="product-grid-skeleton"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="border-border flex flex-col gap-2 rounded-[var(--radius-card)] border p-2"
        >
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
