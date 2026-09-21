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
 * COD reconciliation for the office (docs/ROUTES.md §8, D-12).
 *
 * Answers the three questions somebody has to ask every day:
 *
 *   1. **How much of our money is in pockets right now?** (`totalOutstandingPaise`)
 *   2. **Who is over the float limit** and therefore not being offered cash work?
 *   3. **What is waiting to be counted?** — and counting it is the only thing that reduces a
 *      driver's liability.
 *
 * The verify form asks for the amount COUNTED, pre-filled with the declaration but editable,
 * because the whole purpose of the two-step is to capture the difference when they disagree. A
 * one-click "confirm" would quietly credit whatever the driver claimed.
 */

interface DriverRow {
  driverId: string;
  driverName: string;
  driverCode: string;
  cashInHandPaise: number;
  lastEntryAt: string | null;
  isOverLimit: boolean;
}

interface DepositRow {
  id: string;
  driverName: string;
  driverCode: string;
  declaredAmountPaise: number;
  method: string;
  reference: string;
  declaredAt: string;
}

interface VarianceRow {
  deliveryId: string;
  orderNumber: string;
  driverName: string | null;
  expectedPaise: number | null;
  collectedPaise: number | null;
  variancePaise: number;
}

export function AdminCashBoard({ canReconcile }: { canReconcile: boolean }) {
  const t = useTranslations('cash');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'hi';
  const format = useFormatter();

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [totals, setTotals] = useState({ outstanding: 0, overLimit: 0, limit: 0 });
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [variances, setVariances] = useState<VarianceRow[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [countedRupees, setCountedRupees] = useState<Record<string, string>>({});

  const money = (value: number) => formatPaise(paise(value), locale);

  const load = useCallback(async () => {
    try {
      const [driversResponse, depositsResponse, variancesResponse] = await Promise.all([
        fetch('/api/v1/admin/cash/drivers', { cache: 'no-store' }),
        fetch('/api/v1/admin/cash/deposits?status=DECLARED', { cache: 'no-store' }),
        fetch('/api/v1/admin/cash/variances', { cache: 'no-store' }),
      ]);

      const driversPayload = (await driversResponse.json()) as {
        success: boolean;
        data?: {
          drivers: DriverRow[];
          totalOutstandingPaise: number;
          overLimitCount: number;
          limitPaise: number;
        };
        error?: { message?: string };
      };

      if (!driversResponse.ok || !driversPayload.success || !driversPayload.data) {
        setError(driversPayload.error?.message ?? tCommon('retry'));
        return;
      }

      setDrivers(driversPayload.data.drivers);
      setTotals({
        outstanding: driversPayload.data.totalOutstandingPaise,
        overLimit: driversPayload.data.overLimitCount,
        limit: driversPayload.data.limitPaise,
      });

      const depositsPayload = (await depositsResponse.json()) as {
        success: boolean;
        data?: { deposits: DepositRow[] };
      };
      if (depositsResponse.ok && depositsPayload.data) setDeposits(depositsPayload.data.deposits);

      const variancesPayload = (await variancesResponse.json()) as {
        success: boolean;
        data?: { variances: VarianceRow[] };
      };
      if (variancesResponse.ok && variancesPayload.data)
        setVariances(variancesPayload.data.variances);

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

  const settle = useCallback(
    async (depositId: string, action: 'verify' | 'reject', body: Record<string, unknown>) => {
      setBusyId(depositId);
      setError(null);

      try {
        const response = await fetch(`/api/v1/admin/cash/deposits/${depositId}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const payload = (await response.json()) as {
          success: boolean;
          error?: { message?: string };
        };

        if (!response.ok || !payload.success) {
          setError(payload.error?.message ?? tCommon('retry'));
          return;
        }

        await load();
      } catch {
        setError(tCommon('retry'));
      } finally {
        setBusyId(null);
      }
    },
    [load, tCommon]
  );

  // Same reason as the driver console: the container must exist in the first rendered frame.
  if (isLoading) {
    return (
      <div data-testid="admin-cash-board">
        <LoadingState title={tCommon('loading')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="admin-cash-board">
      {error && <ErrorState title={tCommon('retry')} description={error} />}

      {/* ---- Exposure ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.exposureTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-2xl font-semibold" data-testid="admin-cash-outstanding">
              {money(totals.outstanding)}
            </p>
            <p className="text-muted-foreground">{t('admin.outstanding')}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold" data-testid="admin-cash-over-limit">
              {totals.overLimit}
            </p>
            <p className="text-muted-foreground">
              {t('admin.overLimit', { limit: money(totals.limit) })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ---- The verification queue ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.queueTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {deposits.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="admin-queue-empty">
              {t('admin.queueEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-4" data-testid="admin-deposit-queue">
              {deposits.map((deposit) => (
                <li
                  key={deposit.id}
                  className="border-border flex flex-col gap-2 border-b pb-3 text-sm last:border-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{deposit.driverName}</span>{' '}
                      <span className="text-muted-foreground">({deposit.driverCode})</span>
                    </span>
                    <span className="font-medium">{money(deposit.declaredAmountPaise)}</span>
                  </div>

                  <p className="text-muted-foreground text-xs">
                    {t(`method.${deposit.method}`)} · {deposit.reference} ·{' '}
                    {format.dateTime(new Date(deposit.declaredAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>

                  {canReconcile ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs">{t('admin.countedLabel')}</span>
                        <Input
                          className="w-32"
                          inputMode="decimal"
                          /* Pre-filled with the declaration but EDITABLE: the difference is the
                             entire reason this step exists. */
                          value={
                            countedRupees[deposit.id] ?? String(deposit.declaredAmountPaise / 100)
                          }
                          onChange={(event) =>
                            setCountedRupees((current) => ({
                              ...current,
                              [deposit.id]: event.target.value,
                            }))
                          }
                          data-testid="admin-counted-amount"
                        />
                      </label>

                      <Button
                        size="sm"
                        disabled={busyId === deposit.id}
                        onClick={() =>
                          void settle(deposit.id, 'verify', {
                            verifiedAmountPaise: Math.round(
                              Number(
                                countedRupees[deposit.id] ?? deposit.declaredAmountPaise / 100
                              ) * 100
                            ),
                          })
                        }
                        data-testid="admin-verify-deposit"
                      >
                        {t('admin.verify')}
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === deposit.id}
                        onClick={() =>
                          void settle(deposit.id, 'reject', {
                            reason: t('admin.defaultRejectReason'),
                          })
                        }
                        data-testid="admin-reject-deposit"
                      >
                        {t('admin.reject')}
                      </Button>
                    </div>
                  ) : (
                    /* Read-only for `cash:view` without `cash:reconcile`. Showing a disabled form
                       is clearer than hiding the queue: seeing the work and not being able to do
                       it is the correct experience for that role. */
                    <p
                      className="text-muted-foreground text-xs"
                      data-testid="admin-cannot-reconcile"
                    >
                      {t('admin.readOnly')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Who is holding what ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.driversTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm" data-testid="admin-cash-drivers">
            {drivers.map((driver) => (
              <li
                key={driver.driverId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {driver.driverName}{' '}
                  <span className="text-muted-foreground text-xs">({driver.driverCode})</span>
                </span>
                <span className="flex items-center gap-2">
                  {driver.isOverLimit && <Badge variant="danger">{t('admin.blocked')}</Badge>}
                  <span className="font-medium">{money(driver.cashInHandPaise)}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ---- Variances ---- */}
      {variances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('admin.variancesTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Never resolved automatically: a person decides whether it was a counting error, a
                discount somebody gave away, or a shortfall. */}
            <ul className="flex flex-col gap-2 text-sm" data-testid="admin-cash-variances">
              {variances.map((row) => (
                <li
                  key={row.deliveryId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {row.orderNumber}
                    {row.driverName && (
                      <span className="text-muted-foreground text-xs"> · {row.driverName}</span>
                    )}
                  </span>
                  <span className="text-warning">
                    {t('admin.short', { amount: money(Math.abs(row.variancePaise)) })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
