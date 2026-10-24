'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/**
 * Reorder — adds this order's items back to the cart (docs/ROUTES.md §5).
 *
 * Sends `{ variantId, quantity }` per line and NOTHING ELSE. The price is deliberately not
 * carried over: the customer is buying today at today's price, and reusing a historical price
 * would either overcharge or undercharge them. The order's snapshot exists to record what
 * happened, not to resurrect it.
 *
 * Lines are added SEQUENTIALLY, not in parallel. The cart is a single row read-modify-written
 * per request, so concurrent adds would race and silently lose items.
 *
 * PARTIAL SUCCESS IS THE NORMAL CASE and is reported as such: something bought a month ago is
 * routinely discontinued or out of stock, and the server rejects those rather than adding an
 * unavailable product. Saying "3 of 5 items added" is far more useful than failing the whole
 * action because one item is gone.
 */
export function ReorderButton({
  lines,
}: {
  lines: Array<{ variantId: string | null; quantity: number }>;
}) {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [pending, setPending] = useState(false);
  const [skipped, setSkipped] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reorder = useCallback(async () => {
    setPending(true);
    setError(null);
    setSkipped(null);

    // A line whose variant was hard-deleted has nothing to re-add; counted as skipped rather
    // than attempted with a null id.
    const orderable = lines.filter(
      (line): line is { variantId: string; quantity: number } => line.variantId !== null
    );

    let added = 0;

    try {
      for (const line of orderable) {
        const response = await fetch('/api/v1/cart/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantId: line.variantId, quantity: line.quantity }),
        });

        if (response.ok) added += 1;
      }
    } catch {
      setError(tCommon('retry'));
      setPending(false);
      return;
    }

    setPending(false);

    if (added === 0) {
      setError(t('reorder.noneAvailable'));
      return;
    }

    if (added < lines.length) {
      setSkipped(lines.length - added);
      return;
    }

    router.push('/cart');
  }, [lines, router, t, tCommon]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        onClick={() => void reorder()}
        disabled={pending}
        data-testid="order-reorder"
      >
        {pending ? t('reorder.pending') : t('reorder.action')}
      </Button>

      {/* Shown instead of navigating, so the customer learns what is missing BEFORE they are
          looking at a cart that is quietly smaller than the order they reordered. */}
      {skipped !== null && (
        <p className="text-muted-foreground text-sm" data-testid="order-reorder-partial">
          {t('reorder.partial', { count: skipped })}
        </p>
      )}

      {error && (
        <p className="text-danger text-sm" role="alert" data-testid="order-reorder-error">
          {error}
        </p>
      )}
    </div>
  );
}
