'use client';

import { useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { CountBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/feedback/states';
import { useShell } from '@/components/providers/shell-provider';
import { Link } from '@/i18n/navigation';
import { formatPaise, paise } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Cart mini-drawer — SHELL ONLY (master spec §7 "Cart mini-drawer").
 *
 * Renders whatever `CartSummary` it is given and formats money with the shared
 * paise helpers. It performs NO arithmetic: totals, discounts, delivery fees and
 * the free-delivery gap are computed server-side by the `pricing` module (TASK
 * 008). Deriving a total here would duplicate the one piece of logic that must
 * exist exactly once.
 */

export function CartTrigger({ className }: { className?: string }) {
  const t = useTranslations('nav');
  const { cart, openCart } = useShell();

  return (
    <button
      type="button"
      onClick={openCart}
      data-testid="cart-trigger"
      className={cn(
        'relative inline-flex size-11 items-center justify-center rounded-[var(--radius-control)]',
        'hover:bg-muted transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
        className
      )}
    >
      <ShoppingCart aria-hidden="true" className="size-5" />
      <CountBadge count={cart.itemCount} srLabel={t('cartItemCount', { count: cart.itemCount })} />
      <span className="sr-only">{t('openCart')}</span>
    </button>
  );
}

export function CartDrawer() {
  const t = useTranslations('cart');
  const tCommon = useTranslations('common');
  const { cart, isCartOpen, setCartOpen } = useShell();

  const isEmpty = cart.itemCount === 0;

  return (
    <Sheet open={isCartOpen} onOpenChange={setCartOpen}>
      <SheetContent
        side="right"
        title={t('title')}
        closeLabel={tCommon('close')}
        data-testid="cart-drawer"
        footer={
          isEmpty ? null : (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground text-sm">{t('subtotal')}</span>
                {/* Server-computed value, formatted only. */}
                <span className="text-base font-semibold">
                  {formatPaise(paise(cart.totalAmountPaise))}
                </span>
              </div>
              <SheetClose asChild>
                <Button asChild block>
                  <Link href="/cart">{t('viewCart')}</Link>
                </Button>
              </SheetClose>
            </div>
          )
        }
      >
        {isEmpty ? (
          // An empty cart is not an error, and the state explains the next step
          // (master spec §25).
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <SheetClose asChild>
                <Button asChild variant="outline">
                  <Link href="/categories">{t('startShopping')}</Link>
                </Button>
              </SheetClose>
            }
          />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {cart.lines.map((line) => (
              <li key={line.id} className="flex gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.productName}</p>
                  {line.unitLabel ? (
                    <p className="text-muted-foreground text-xs">{line.unitLabel}</p>
                  ) : null}
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('quantityShort', { count: line.quantity })}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {formatPaise(paise(line.lineTotalPaise))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
