import { formatPaise, paise } from '@/lib/money';
import type { Locale } from '@/i18n/routing';
import type { OfferCardLabels, OfferCardView } from '@/lib/marketing/view';
import { Card, CardContent } from '@/components/ui/card';
import { CopyCouponCode } from './copy-coupon-code';

/**
 * One coupon, as a customer sees it on `/offers`.
 *
 * The code is the thing they came for, so it is the most prominent element and is
 * copyable in one tap — a code you have to select by hand on a phone is a code that
 * does not get used.
 *
 * Every condition is stated on the card (minimum cart, cap, first-order,
 * expiry). Hiding a condition until the cart refuses the coupon is how a discount
 * turns into a complaint.
 */

export function OfferCard({
  offer,
  locale,
  labels,
}: {
  offer: OfferCardView;
  locale: Locale;
  labels: OfferCardLabels;
}) {
  const conditions = [
    labels.minCart(formatPaise(paise(offer.minCartPaise), locale)),
    offer.maxDiscountPaise === null
      ? null
      : labels.upTo(formatPaise(paise(offer.maxDiscountPaise), locale)),
    offer.firstOrderOnly ? labels.firstOrderOnly : null,
    offer.validUntil ? labels.expires(formatDate(offer.validUntil, locale)) : null,
  ].filter((condition): condition is string => condition !== null);

  return (
    <Card data-testid="offer-card">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold" data-testid="offer-name">
              {offer.name}
            </h2>
            {offer.description && (
              <p className="text-muted-foreground mt-1 text-sm">{offer.description}</p>
            )}
          </div>

          <CopyCouponCode code={offer.code} copyLabel={labels.copy} copiedLabel={labels.copied} />
        </div>

        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {conditions.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Formats an expiry date in the customer's locale.
 *
 * `hi-IN` rather than `hi`: the bare language tag gives Latin digits and month
 * names a Hindi reader would not expect.
 */
function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(value);
}
