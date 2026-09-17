import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { formatPaise, paise } from '@/lib/money';
import { getDriverEarningsForUser } from '@/modules/driver-earnings';

/**
 * Driver earnings — real, read-only ledger view (docs/ROUTES.md §7).
 *
 * The authenticated user is resolved to their driver row inside the earnings module. No driver id
 * is accepted from route params or client state, so a driver cannot enumerate another driver's
 * earnings. The underlying table is append-only and this screen never mutates settlement state.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'driverNav' });

  return { title: t('earnings'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await requireCurrentActor();
  const [{ totalPaise, entries }, tNav, tEmpty, format] = await Promise.all([
    getDriverEarningsForUser(actor.userId),
    getTranslations('driverNav'),
    getTranslations('states.empty'),
    getFormatter(),
  ]);

  const moneyLocale = locale === 'hi' ? 'hi' : 'en';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" data-testid="driver-earnings">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">{tNav('earnings')}</h1>
        <p className="text-lg font-semibold" data-testid="driver-earnings-total">
          {formatPaise(paise(totalPaise), moneyLocale)}
        </p>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="p-4">
            <p className="font-medium">{tEmpty('title')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{tEmpty('description')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{entry.earningType.replaceAll('_', ' ')}</Badge>
                      {entry.payoutBatchId && <Badge variant="success">PAID</Badge>}
                    </div>
                    {entry.description && <p className="mt-2 text-sm">{entry.description}</p>}
                    <p className="text-muted-foreground mt-1 text-xs">
                      {format.dateTime(new Date(entry.earnedOn), { dateStyle: 'medium' })}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold">
                    {entry.amountPaise > 0 ? '+' : ''}
                    {formatPaise(paise(entry.amountPaise), moneyLocale)}
                  </span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
