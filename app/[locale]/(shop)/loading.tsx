import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading skeleton for shop pages (master spec §24, §25).
 *
 * Mirrors the real page layout — heading then a card grid — so content arriving
 * does not shift the layout. A spinner would be simpler but would cause exactly
 * that shift.
 *
 * The shell (header, nav, footer) stays mounted around this, so only the content
 * area shows placeholders.
 */
export default function ShopLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:py-8" aria-busy="true">
      <Skeleton className="mb-6 h-7 w-56" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
