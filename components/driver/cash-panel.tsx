'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/feedback/states';
import { Input } from '@/components/ui/input';
import { formatPaise, paise } from '@/lib/money';

/**
 * The driver's cash screen (docs/ROUTES.md §7, D-12).
 *
 * Its real job is to make a liability VISIBLE. The money in a rider's pocket belongs to the
 * platform, and the single most common cause of a dispute is a driver who does not know how much
 * they are carrying. So the float, the limit, the headroom and every movement that produced them
 * are all on one screen — the same rows the office sees, which is a very different conversation
 * from "the app says you owe us this".
 *
 * It also states plainly when COD work has stopped because of the limit, rather than leaving the
 * offer list mysteriously empty.
 */

interface Position {
  cashInHandPaise: number;
  limitPaise: number;
  headroomPaise: number;
  isCodBlocked: boolean;
  isOverdue: boolean;
  graceHours: number;
}

interface LedgerEntry {
  id: string;
  entryType: string;
  amountPaise: number;
  reason: string | null;
  createdAt: string;
}

interface Deposit {
  id: string;
  declaredAmountPaise: number;
  verifiedAmountPaise: number | null;
  variancePaise: number | null;
  status: string;
  method: string;
  reference: string;
  declaredAt: string;
  rejectionReason: string | null;
}

export function DriverCashPanel() {
  const t = useTranslations('cash');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';
  const format = useFormatter();

  const [position, setPosition] = useState<Position | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [amountRupees, setAmountRupees] = useState('');
  const [method, setMethod] = useState<'OFFICE_CASH' | 'BANK_TRANSFER' | 'UPI'>('OFFICE_CASH');
  const [reference, setReference] = useState('');

  const money = (value: number) => formatPaise(paise(value), locale);

  const load = useCallback(async () => {
    try {
      const [positionResponse, ledgerResponse, depositsResponse] = await Promise.all([
        fetch('/api/v1/driver/cash', { cache: 'no-store' }),
        fetch('/api/v1/driver/cash/ledger', { cache: 'no-store' }),
        fetch('/api/v1/driver/cash/deposits', { cache: 'no-store' }),
      ]);

      const positionPayload = (await positionResponse.json()) as {
        success: boolean;
        data?: Position;
        error?: { message?: string };
      };

      if (!positionResponse.ok || !positionPayload.success || !positionPayload.data) {
        setError(positionPayload.error?.message ?? tCommon('retry'));
        return;
      }

      setPosition(positionPayload.data);

      const ledgerPayload = (await ledgerResponse.json()) as {
        success: boolean;
        data?: { items: LedgerEntry[] };
      };
      if (ledgerResponse.ok && ledgerPayload.data) setLedger(ledgerPayload.data.items);

      const depositsPayload = (await depositsResponse.json()) as {
        success: boolean;
        data?: { deposits: Deposit[] };
      };
      if (depositsResponse.ok && depositsPayload.data) setDeposits(depositsPayload.data.deposits);

      setError(null);
    } catch {
      setError(tCommon('retry'));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const declare = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/driver/cash/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Rupees in, paise on the wire.
          declaredAmountPaise: Math.round(Number(amountRupees) * 100),
          method,
          reference: reference.trim() || null,
          /**
           * A key derived from the amount and the reference, not a random one.
           *
           * A driver on a bad connection taps "declare" twice; both requests must resolve to the
           * SAME deposit, or an admin verifies the money twice.
           */
          idempotencyKey: `dep-${method}-${Math.round(Number(amountRupees) * 100)}-${reference.trim() || 'none'}`,
        }),
      });

      const payload = (await response.json()) as { success: boolean; error?: { message?: string } };

      if (!response.ok || !payload.success) {
        setError(payload.error?.message ?? tCommon('retry'));
        return;
      }

      setAmountRupees('');
      setReference('');
      await load();
    } catch {
      setError(tCommon('retry'));
    } finally {
      setBusy(false);
    }
  }, [amountRupees, load, method, reference, tCommon]);

  // The wrapper renders on the first frame, so the screen exists in the server-rendered HTML
  // before any data has arrived.
  if (isLoading || !position) {
    return (
      <div data-testid="driver-cash-panel">
        {isLoading ? (
          <LoadingState title={tCommon('loading')} />
        ) : (
          <ErrorState title={tCommon('retry')} description={error ?? ''} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="driver-cash-panel">
      {error && <ErrorState title={tCommon('retry')} description={error} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('inHandTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-2xl font-semibold" data-testid="driver-cash-in-hand">
            {money(position.cashInHandPaise)}
          </p>
          <p className="text-muted-foreground">
            {t('limitLine', {
              limit: money(position.limitPaise),
              headroom: money(position.headroomPaise),
            })}
          </p>

          {position.isCodBlocked && (
            <p className="text-danger font-medium" data-testid="driver-cash-blocked-notice">
              {t('blocked')}
            </p>
          )}

          {position.isOverdue && (
            <p className="text-warning" data-testid="driver-cash-overdue">
              {t('overdue', { hours: position.graceHours })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Declare a deposit ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('declareTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {/* Said before the form, not after: a driver who thinks declaring settles it will stop
              carrying the money in their head. */}
          <p className="text-muted-foreground">{t('declareNote')}</p>

          <label className="flex flex-col gap-1">
            <span>{t('amountLabel')}</span>
            <Input
              value={amountRupees}
              onChange={(event) => setAmountRupees(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              data-testid="driver-deposit-amount"
            />
          </label>

          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t('methodLabel')}</legend>
            {(['OFFICE_CASH', 'BANK_TRANSFER', 'UPI'] as const).map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={method === candidate ? 'primary' : 'secondary'}
                onClick={() => setMethod(candidate)}
              >
                {t(`method.${candidate}`)}
              </Button>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1">
            <span>{t('referenceLabel')}</span>
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={t('referencePlaceholder')}
              maxLength={80}
              data-testid="driver-deposit-reference"
            />
          </label>

          <Button
            onClick={() => void declare()}
            disabled={busy || Number(amountRupees) <= 0}
            data-testid="driver-deposit-submit"
          >
            {t('declareAction')}
          </Button>
        </CardContent>
      </Card>

      {/* ---- Deposits ---- */}
      {deposits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('depositsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm" data-testid="driver-deposits">
              {deposits.map((deposit) => (
                <li key={deposit.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {money(deposit.declaredAmountPaise)} ·{' '}
                    {format.dateTime(new Date(deposit.declaredAt), { dateStyle: 'medium' })}
                  </span>
                  <span className="flex items-center gap-2">
                    {/* PARTIAL is shown as a warning rather than a success: it means the count did
                        not match the declaration. */}
                    <Badge
                      variant={
                        deposit.status === 'VERIFIED'
                          ? 'success'
                          : deposit.status === 'REJECTED'
                            ? 'danger'
                            : deposit.status === 'PARTIAL'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {t(`status.${deposit.status}`)}
                    </Badge>
                    {deposit.variancePaise !== null && deposit.variancePaise !== 0 && (
                      <span className="text-warning text-xs">
                        {t('variance', { amount: money(Math.abs(deposit.variancePaise)) })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---- The ledger ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ledgerTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('ledgerEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm" data-testid="driver-cash-ledger">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{t(`entry.${entry.entryType}`)}</span>
                    {entry.reason && (
                      <span className="text-muted-foreground block text-xs">{entry.reason}</span>
                    )}
                  </span>
                  {/* Signed, and coloured by direction: a driver should be able to see at a glance
                      which rows increased what they owe. */}
                  <span className={entry.amountPaise < 0 ? 'text-success' : undefined}>
                    {entry.amountPaise < 0 ? '−' : '+'} {money(Math.abs(entry.amountPaise))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
