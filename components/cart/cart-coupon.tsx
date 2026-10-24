'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/providers/toaster';
import { formatPaise, paise } from '@/lib/money';
import type { Locale } from '@/i18n/routing';
import type { CartCouponView } from '@/lib/marketing/view';

/**
 * Apply / remove a coupon on the cart.
 *
 * The server decides everything. This sends a CODE and re-reads the tree, so the
 * discount, the delivery waiver and the new total are all the server's numbers —
 * computing a discount here would mean the cart could show a saving checkout would
 * not honour.
 *
 * A REFUSAL IS SHOWN IN PLACE, not as a toast that disappears. "Add ₹120 more to use
 * this coupon" is an instruction the customer needs to still be able to read while
 * they add items.
 */
export function CartCoupon({
  coupon,
  locale,
}: {
  coupon: CartCouponView | null;
  /** Passed from the server page: money must format in the customer's locale. */
  locale: Locale;
}) {
  const t = useTranslations('cart');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSaving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const busy = isSaving || isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim().length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/cart/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const body = (await response.json()) as {
        success?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !body.success) {
        // The server's message is specific ("only valid on your first order"), so it
        // is shown as-is rather than replaced with a generic failure.
        setError(body.error?.message ?? t('couponFailed'));
        return;
      }

      setCode('');
      startTransition(() => router.refresh());
    } catch {
      setError(t('couponFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/cart/coupon', { method: 'DELETE' });
      if (!response.ok) {
        toast.error(t('couponFailed'));
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error(t('couponFailed'));
    } finally {
      setSaving(false);
    }
  }

  // An applied coupon shows what it is worth and how to drop it — nothing to type.
  if (coupon?.isApplied) {
    return (
      <div className="border-border mt-3 border-t pt-3" data-testid="cart-coupon">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold" data-testid="cart-coupon-applied">
              {coupon.code}
            </p>
            <p className="text-success text-xs">
              {coupon.waivesDeliveryFee
                ? t('couponFreeDelivery')
                : t('couponApplied', {
                    amount: formatPaise(paise(coupon.discountPaise), locale),
                  })}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label={t('couponRemove')}
            data-testid="cart-coupon-remove"
            className="text-muted-foreground hover:text-danger p-2 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <X aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="border-border mt-3 border-t pt-3"
      data-testid="cart-coupon"
    >
      <label htmlFor="cart-coupon-code" className="text-muted-foreground text-xs font-medium">
        {t('couponLabel')}
      </label>

      <div className="mt-1 flex gap-2">
        <Input
          id="cart-coupon-code"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          // Codes are stored uppercase; showing them that way avoids a "why did it
          // change what I typed" moment on submit.
          className="font-mono uppercase"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('couponPlaceholder')}
          disabled={busy}
          {...(error ? { 'aria-invalid': true, 'aria-describedby': 'cart-coupon-error' } : {})}
          data-testid="cart-coupon-input"
        />
        <Button type="submit" variant="secondary" disabled={busy || code.trim().length === 0}>
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : t('couponApply')}
        </Button>
      </div>

      {/* A coupon carried on the cart that stopped applying — e.g. an item was
          removed and the cart fell below the minimum. Reported, not silently dropped. */}
      {coupon && !coupon.isApplied && !error && (
        <p className="text-danger mt-2 text-xs" data-testid="cart-coupon-dropped">
          {t('couponNoLongerApplies', { code: coupon.code })}
        </p>
      )}

      {error && (
        <p
          id="cart-coupon-error"
          role="alert"
          className="text-danger mt-2 text-xs"
          data-testid="cart-coupon-error"
        >
          {error}
        </p>
      )}
    </form>
  );
}
