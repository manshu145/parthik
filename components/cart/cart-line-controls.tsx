'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import { toast } from '@/components/providers/toaster';
import { cn } from '@/lib/utils';

/**
 * Quantity stepper and remove control for one cart line.
 *
 * Every change goes to the server and the tree is refreshed, so the line total,
 * delivery fee, free-delivery gap and minimum-order status are always the server's
 * numbers. Adjusting a quantity locally would mean the displayed total briefly
 * disagreed with what checkout would charge.
 *
 * Buttons are disabled while in flight rather than debounced: a double-click on
 * "+" must not send two increments.
 */
export function CartLineControls({
  variantId,
  productName,
  quantity,
  maxQuantity,
  className,
}: {
  variantId: string;
  productName: string;
  quantity: number;
  /** Lower of the stock available and the per-line guardrail. */
  maxQuantity: number;
  className?: string;
}) {
  const t = useTranslations('cart');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSaving, setSaving] = useState(false);

  const busy = isSaving || isPending;

  async function mutate(next: number | 'remove') {
    setSaving(true);

    try {
      const response =
        next === 'remove'
          ? await fetch(`/api/v1/cart/items/${variantId}`, { method: 'DELETE' })
          : await fetch(`/api/v1/cart/items/${variantId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ quantity: next }),
            });

      const body = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !body.success) {
        toast.error(body.error?.message ?? t('updateFailed'));
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      toast.error(t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="border-border flex items-center rounded-[var(--radius-control)] border">
        <button
          type="button"
          onClick={() => void mutate(quantity - 1)}
          disabled={busy}
          aria-label={t('decrease')}
          data-testid="cart-decrease"
          className="hover:bg-muted flex size-9 items-center justify-center disabled:opacity-50"
        >
          <Minus aria-hidden="true" className="size-4" />
        </button>

        <span
          className="min-w-8 text-center text-sm font-medium"
          aria-live="polite"
          data-testid="cart-quantity"
        >
          {busy ? <Loader2 aria-hidden="true" className="mx-auto size-4 animate-spin" /> : quantity}
        </span>

        <button
          type="button"
          onClick={() => void mutate(quantity + 1)}
          // Capped at what can actually be sold, so the customer is not invited to
          // exceed stock and then told off.
          disabled={busy || quantity >= maxQuantity}
          aria-label={t('increase')}
          data-testid="cart-increase"
          className="hover:bg-muted flex size-9 items-center justify-center disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => void mutate('remove')}
        disabled={busy}
        aria-label={t('removeItem', { name: productName })}
        data-testid="cart-remove"
        className="text-muted-foreground hover:text-danger p-2 disabled:opacity-50"
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
