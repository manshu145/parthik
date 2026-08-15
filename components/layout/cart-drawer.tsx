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
 * Cart mini-drawer (master spec §7).
 *
 * Renders whatever `CartSummary` it is given and formats money with the shared
 * paise helpers. It performs NO arithmetic: every figure comes from the pricing
 * engine server-side. Deriving a total here would duplicate the one piece of logic
 * that must exist exactly once.
 *
 * The subtotal, delivery fee and grand total are shown as SEPARATE lines. Labelling
 * a grand total "subtotal" — or hiding the delivery fee until checkout — is how a
 * customer is surprised at the last step.
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
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground text-sm">{t('itemsSubtotal')}</span>
                  <span className="text-sm">{formatPaise(paise(cart.subtotalPaise))}</span>
                </div>

                {/* Only shown once a location makes the fee knowable. Rendering ₹0
                    for an unknown fee would be a promise we have not made. */}
                {!cart.isQuoteIncomplete && (
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground text-sm">{t('deliveryFee')}</span>
                    <span className="text-sm">
                      {cart.isDeliveryFree ? (
                        <span className="text-success font-medium">{t('free')}</span>
                      ) : (
                        formatPaise(paise(cart.deliveryFeePaise))
                      )}
                    </span>
                  </div>
                )}

                <div className="border-border mt-1 flex items-baseline justify-between border-t pt-2">
                  <span className="text-sm font-medium">{t('grandTotal')}</span>
                  <span className="text-base font-semibold" data-testid="cart-total">
                    {formatPaise(paise(cart.totalAmountPaise))}
                  </span>
                </div>

                {cart.isQuoteIncomplete && (
                  <p className="text-muted-foreground text-xs" data-testid="cart-quote-incomplete">
                    {t('quoteIncomplete')}
                  </p>
                )}

                {cart.freeDeliveryGapPaise !== null && (
                  <p className="text-primary text-xs" data-testid="cart-free-delivery-gap">
                    {t('freeDeliveryGap', {
                      amount: formatPaise(paise(cart.freeDeliveryGapPaise)),
                    })}
                  </p>
                )}
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
