import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { formatPaise, paise } from '@/lib/money';
import { OrderStatusBadge } from '@/components/orders/order-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getDriverHistoryRepository } from '@/modules/driver-history';

/**
 * Driver delivery history — REAL SCREEN (docs/ROUTES.md §7).
 *
 * Ownership is resolved from the authenticated user's driver record; the request never accepts a
 * driver id. Pagination uses an opaque `(createdAt, id)` keyset cursor so rows that share the same
 * timestamp cannot disappear at a page boundary.
 *
 * This screen deliberately does not expose historical customer phone numbers or addresses. Those
 * fields are operationally necessary only while a delivery is active; keeping them visible in an
 * indefinite history would turn a temporary delivery need into a permanent PII leak.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('history'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const repository = await getDriverHistoryRepository();
  const [{ items, nextCursor }, tNav, tConsole, format] = await Promise.all([
    repository.listForUser(actor.userId, { limit: 25, cursor: query.cursor }),
    getTranslations('driverNav'),
    getTranslations('driverConsole'),
    getFormatter(),
  ]);

  const moneyLocale = locale === 'hi' ? 'hi' : 'en';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-history">
      <h1 className="text-xl font-semibold">{tNav('history')}</h1>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{tConsole('noOffers')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {items.map(({ delivery, order }) => (
              <li key={delivery.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{order.orderNumber}</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {format.dateTime(delivery.createdAt, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>
                      <OrderStatusBadge status={order.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {order.isCod ? (
                        <Badge variant="warning">
                          {tConsole('offerCod', {
                            amount: formatPaise(
                              paise(delivery.codExpectedPaise ?? order.codAmountPaise ?? 0),
                              moneyLocale
                            ),
                          })}
                        </Badge>
                      ) : (
                        <Badge>{tConsole('prepaid')}</Badge>
                      )}

                      <span className="text-muted-foreground">
                        {formatPaise(paise(order.totalAmountPaise), moneyLocale)}
                      </span>
                    </div>

                    {delivery.failedAt && delivery.failureReason && (
                      <p className="text-destructive text-sm">{delivery.failureReason}</p>
                    )}

                    {delivery.deliveredAt && (
                      <p className="text-muted-foreground text-xs">
                        {format.dateTime(delivery.deliveredAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button asChild variant="secondary">
                <a href={`?cursor=${encodeURIComponent(nextCursor)}`}>
                  {locale === 'hi' ? 'अगला पेज' : 'Next page'}
                </a>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
