import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isLocale } from '@/i18n/routing';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductImage } from '@/components/catalog/product-image';
import { CartLineControls } from '@/components/cart/cart-line-controls';
import { CartCoupon } from '@/components/cart/cart-coupon';
import { getCartView } from '@/lib/shell/current-cart';
import { formatPaise, paise } from '@/lib/money';
import { MAX_QUANTITY_PER_LINE } from '@/modules/cart';

/**
 * Cart page (master spec §12).
 *
 * Shows everything §12 requires: lines, quantities, item subtotal, savings, delivery
 * fee, the free-delivery threshold, the minimum-order requirement, the estimated
 * delivery window and the grand total.
 *
 * NO TAX LINE — D-14 is unresolved, and rendering "₹0 GST" would assert a tax
 * treatment nobody has authorised.
 *
 * `noindex`: a cart is per-customer and has nothing to index.
 */

/**
 * A cart is per-customer and read from cookies, so it can never be prerendered.
 * Declaring it here is clearer than relying on cookie access to force it.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.cart' });

  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('cart');
  const tPage = await getTranslations('pages.cart');
  const tCatalog = await getTranslations('catalog');

  const view = await getCartView(locale);

  if (!view) {
    return (
      <PageShell title={tPage('heading')}>
        <ErrorState
          title={tCatalog('unavailableTitle')}
          description={tCatalog('unavailableDescription')}
        />
      </PageShell>
    );
  }

  if (view.lines.length === 0) {
    return (
      <PageShell title={tPage('heading')}>
        <EmptyState
          title={t('emptyTitle')}
          description={t('pageEmptyDescription')}
          action={
            <Button asChild>
              <Link href="/categories">{t('startShopping')}</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  const { totals } = view;

  const minOrderIssue = view.issues.find((issue) => issue.code === 'MIN_ORDER_NOT_MET');
  const locationIssue = view.issues.find((issue) => issue.code === 'LOCATION_REQUIRED');
  const serviceIssue = view.issues.find((issue) => issue.code === 'NOT_SERVICEABLE');

  return (
    <PageShell title={tPage('heading')} description={t('itemCount', { count: totals.itemCount })}>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* ---- Lines ---- */}
        <ul className="divide-border flex flex-col divide-y" data-testid="cart-lines">
          {view.lines.map((line) => {
            const stockCap = line.quantityAvailable ?? MAX_QUANTITY_PER_LINE;

            return (
              <li key={line.id} className="flex gap-3 py-4" data-testid="cart-line">
                <div className="w-20 shrink-0">
                  <ProductImage
                    storageKey={line.imageKey}
                    alt={null}
                    placeholderLabel={tCatalog('imagePlaceholder')}
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link
                    href={`/products/${line.productSlug}`}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {line.productName}
                  </Link>

                  {line.unitLabel && (
                    <span className="text-muted-foreground text-xs">{line.unitLabel}</span>
                  )}

                  {/* Line problems are stated here, not discovered at checkout. */}
                  {line.issues.map((issue) => (
                    <span key={issue.code} data-testid="cart-line-issue">
                      <Badge variant="danger">
                        {issue.code === 'PRODUCT_UNAVAILABLE'
                          ? t('lineUnavailable')
                          : issue.code === 'INSUFFICIENT_STOCK'
                            ? issue.availableQuantity === 0
                              ? t('outOfStockShort')
                              : t('onlyLeft', { count: issue.availableQuantity })
                            : issue.code === 'QUANTITY_LIMIT_EXCEEDED'
                              ? t('lineQuantityCapped', { max: issue.maxQuantity })
                              : t('updateFailed')}
                      </Badge>
                    </span>
                  ))}

                  <CartLineControls
                    variantId={line.variantId}
                    productName={line.productName}
                    quantity={line.quantity}
                    maxQuantity={Math.min(MAX_QUANTITY_PER_LINE, stockCap)}
                    className="mt-1"
                  />
                </div>

                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-sm font-semibold" data-testid="cart-line-total">
                    {formatPaise(paise(line.lineTotalPaise), locale)}
                  </span>
                  {line.savingsPaise > 0 && (
                    <span className="text-success text-xs">
                      {t('youSaved', { amount: formatPaise(paise(line.savingsPaise), locale) })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* ---- Summary ---- */}
        <aside
          className="border-border h-fit rounded-[var(--radius-card)] border p-4"
          data-testid="cart-summary"
        >
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t('itemsSubtotal')}</dt>
              <dd>{formatPaise(paise(totals.taxableAmountPaise), locale)}</dd>
            </div>

            {/* Shown only when a coupon actually reduced the items. A free-delivery
                coupon discounts nothing here — it shows up as a waived fee below. */}
            {totals.couponDiscountPaise > 0 && (
              <div className="flex justify-between gap-2" data-testid="cart-coupon-discount">
                <dt className="text-muted-foreground">
                  {view.coupon ? t('couponDiscountWithCode', { code: view.coupon.code }) : ''}
                </dt>
                <dd className="text-success">
                  −{formatPaise(paise(totals.couponDiscountPaise), locale)}
                </dd>
              </div>
            )}

            {/* Rendered only once a location makes the fee knowable. */}
            {!totals.isQuoteIncomplete && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('deliveryFee')}</dt>
                <dd>
                  {totals.isDeliveryFree ? (
                    <span className="text-success font-medium">
                      {/* Says WHY it is free, so a coupon's effect is visible. */}
                      {totals.deliveryWaivedBy === 'coupon' ? t('freeByCoupon') : t('free')}
                    </span>
                  ) : (
                    formatPaise(paise(totals.deliveryFeePaise), locale)
                  )}
                </dd>
              </div>
            )}

            {/*
              NO TAX LINE. D-14 is unresolved; `totals.isTaxDisplayable` is false and
              the UI branches on that flag rather than on a zero amount.
            */}

            <div className="border-border mt-1 flex justify-between gap-2 border-t pt-2">
              <dt className="font-medium">{t('grandTotal')}</dt>
              <dd className="text-base font-semibold" data-testid="cart-grand-total">
                {formatPaise(paise(totals.totalAmountPaise), locale)}
              </dd>
            </div>
          </dl>

          <CartCoupon coupon={view.coupon} locale={locale} />

          {totals.totalSavingsPaise > 0 && (
            <p className="text-success mt-2 text-xs" data-testid="cart-savings">
              {t('youSaved', {
                amount: formatPaise(paise(totals.totalSavingsPaise), locale),
              })}
            </p>
          )}

          {totals.freeDeliveryGapPaise !== null && (
            <p className="text-primary mt-2 text-xs" data-testid="cart-free-delivery-gap">
              {t('freeDeliveryGap', {
                amount: formatPaise(paise(totals.freeDeliveryGapPaise), locale),
              })}
            </p>
          )}

          {view.etaMinMinutes !== null && !totals.isQuoteIncomplete && (
            <p className="text-muted-foreground mt-2 text-xs">
              {tCatalog('prepTimeLabel')}: {view.etaMinMinutes}–{view.etaMaxMinutes}{' '}
              {tCatalog('minutes', { count: view.etaMaxMinutes ?? 0 }).replace(/^\d+\s*/, '')}
            </p>
          )}

          {/* ---- Blocking issues, stated before the customer tries to continue ---- */}
          {locationIssue && (
            <p className="mt-3 text-xs" data-testid="cart-issue-location">
              {t('locationRequired')}
            </p>
          )}

          {serviceIssue && (
            <p className="text-danger mt-3 text-xs" data-testid="cart-issue-serviceable">
              {t('notServiceable', { pincode: serviceIssue.pincode })}
            </p>
          )}

          {minOrderIssue && (
            <p className="text-danger mt-3 text-xs" data-testid="cart-issue-min-order">
              {t('minOrderNotMet', {
                min: formatPaise(paise(minOrderIssue.minOrderPaise), locale),
                short: formatPaise(paise(minOrderIssue.shortfallPaise), locale),
              })}
            </p>
          )}

          {totals.isQuoteIncomplete ? (
            <Button block disabled className="mt-4" data-testid="cart-checkout">
              {t('checkout')}
            </Button>
          ) : (
            <Button asChild block className="mt-4" data-testid="cart-checkout">
              <Link href="/checkout">{t('checkout')}</Link>
            </Button>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
