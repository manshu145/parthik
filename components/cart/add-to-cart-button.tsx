'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/providers/toaster';
import { cn } from '@/lib/utils';

/**
 * Add to cart.
 *
 * Posts a VARIANT ID AND QUANTITY — nothing else. No price, no name, no total: the
 * server re-reads all of that, so a tampered request can change what someone
 * intends to buy but never what it costs.
 *
 * Deliberately NOT optimistic. docs/ARCHITECTURE.md §12.4 permits optimistic UI only
 * for reversible, low-stakes actions; an add that appears to succeed and then fails
 * on stock leaves the customer believing they have something they do not. The button
 * waits for the server, then refreshes so the header badge and drawer match.
 */
export function AddToCartButton({
  variantId,
  disabled = false,
  quantity = 1,
  className,
  block = false,
}: {
  variantId: string;
  disabled?: boolean;
  quantity?: number;
  className?: string;
  block?: boolean;
}) {
  const t = useTranslations('cart');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSaving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  async function handleClick() {
    setSaving(true);

    try {
      const response = await fetch('/api/v1/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, quantity }),
      });

      const body = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !body.success) {
        // The server's message is shown because it is the specific reason —
        // "only 3 left", "items from another store" — and a generic failure string
        // would leave the customer with no idea what to do.
        toast.error(body.error?.message ?? t('updateFailed'));
        return;
      }

      setJustAdded(true);
      toast.success(t('added'));

      // Re-render the server tree so the badge, drawer and totals agree.
      startTransition(() => router.refresh());

      setTimeout(() => setJustAdded(false), 2_000);
    } catch {
      toast.error(t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  const busy = isSaving || isPending;

  return (
    <Button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled || busy}
      block={block}
      className={cn(className)}
      data-testid="add-to-cart"
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : justAdded ? (
        <Check aria-hidden="true" />
      ) : (
        <Plus aria-hidden="true" />
      )}
      {busy ? t('adding') : justAdded ? t('added') : t('addToCart')}
    </Button>
  );
}
