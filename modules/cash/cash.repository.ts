import { and, desc, eq, gt, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { cashDeposits, deliveries, driverCashLedger, drivers, orders } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import { ConflictError, NotFoundError } from '@/lib/errors';

/**
 * Driver cash custody (TASK 011b, docs/ARCHITECTURE.md §11.2.1).
 *
 * THE ONE DESIGN DECISION THAT SHAPES THIS FILE: **cash in hand is DERIVED, never stored.**
 * `drivers` deliberately has no `cash_in_hand` column. A running total would be a second source
 * of truth that can drift from the ledger, and the moment it drifts nobody can say which number
 * is right — while the ledger, being append-only, can always be re-summed and audited.
 *
 *     cash in hand = SUM(driver_cash_ledger.amount_paise)
 *       + on COLLECTION   (the driver took the customer's money)
 *       − on DEPOSIT      (they handed it in and an admin verified it)
 *       ± on ADJUSTMENT   (a shortfall, a correction, a write-off)
 */
export class DrizzleCashRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  /** Re-summed from the ledger every time. Cheap: it is indexed by `(driver_id, created_at)`. */
  async cashInHandPaise(driverId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${driverCashLedger.amountPaise}), 0)` })
      .from(driverCashLedger)
      .where(eq(driverCashLedger.driverId, driverId));

    return Number(row?.total ?? 0);
  }

  /**
   * The oldest COLLECTION still un-deposited, for aged-cash alerts.
   *
   * Approximated by the oldest collection since the last deposit: exact per-note tracking is
   * meaningless for cash, and "this driver has been holding money since Tuesday" is the question
   * anyone actually asks.
   */
  async oldestUndepositedAt(driverId: string): Promise<Date | null> {
    const [lastDeposit] = await this.db
      .select({ createdAt: driverCashLedger.createdAt })
      .from(driverCashLedger)
      .where(
        and(eq(driverCashLedger.driverId, driverId), eq(driverCashLedger.entryType, 'DEPOSIT'))
      )
      .orderBy(desc(driverCashLedger.createdAt))
      .limit(1);

    const [oldest] = await this.db
      .select({ createdAt: driverCashLedger.createdAt })
      .from(driverCashLedger)
      .where(
        and(
          eq(driverCashLedger.driverId, driverId),
          eq(driverCashLedger.entryType, 'COLLECTION'),
          /**
           * `gt(...)`, NOT a raw `sql` template.
           *
           * Drizzle only converts a JS `Date` to the wire format when it knows the column type,
           * which it does not inside a raw fragment — so `sql\`… > ${date}\`` sends
           * "Sat Aug 22 2026 …" as a bare parameter and Postgres rejects the whole statement.
           * It typechecks, and it only fails once a driver actually has a verified deposit
           * (docs/DATABASE.md §15.4).
           */
          ...(lastDeposit ? [gt(driverCashLedger.createdAt, lastDeposit.createdAt)] : [])
        )
      )
      .orderBy(driverCashLedger.createdAt)
      .limit(1);

    return oldest?.createdAt ?? null;
  }

  async listLedger(
    driverId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{
    items: Array<{
      id: string;
      entryType: string;
      amountPaise: number;
      orderId: string | null;
      reason: string | null;
      createdAt: Date;
    }>;
    nextCursor: string | null;
  }> {
    const cursorDate = page.cursor ? new Date(page.cursor) : null;

    const rows = await this.db
      .select({
        id: driverCashLedger.id,
        entryType: driverCashLedger.entryType,
        amountPaise: driverCashLedger.amountPaise,
        orderId: driverCashLedger.orderId,
        reason: driverCashLedger.reason,
        createdAt: driverCashLedger.createdAt,
      })
      .from(driverCashLedger)
      .where(
        cursorDate
          ? and(eq(driverCashLedger.driverId, driverId), lt(driverCashLedger.createdAt, cursorDate))
          : eq(driverCashLedger.driverId, driverId)
      )
      .orderBy(desc(driverCashLedger.createdAt))
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const items = (hasMore ? rows.slice(0, page.limit) : rows).map((row) => ({
      id: row.id,
      entryType: row.entryType as string,
      amountPaise: Number(row.amountPaise),
      orderId: row.orderId,
      reason: row.reason,
      createdAt: row.createdAt,
    }));

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.createdAt.toISOString() ?? null) : null,
    };
  }

  /**
   * Declares a deposit. **Declaring is not settling.**
   *
   * No ledger entry is written here, and that is the whole point of the two-step: the driver's
   * cash in hand does NOT fall when they say they paid it in, only when somebody counted it. A
   * single-step deposit would let a driver zero their own float by filling in a form.
   */
  async declareDeposit(input: {
    driverId: string;
    declaredAmountPaise: number;
    method: 'BANK_TRANSFER' | 'OFFICE_CASH' | 'UPI';
    reference: string;
    proofKey: string | null;
    notes: string | null;
  }): Promise<{ ok: true; depositId: string } | { ok: false; reason: 'DUPLICATE_REFERENCE' }> {
    const [created] = await this.db
      .insert(cashDeposits)
      .values({
        driverId: input.driverId,
        depositReference: input.reference,
        declaredAmountPaise: input.declaredAmountPaise,
        method: input.method,
        proofStorageKey: input.proofKey,
        notes: input.notes,
        status: 'DECLARED',
      })
      // The reference is unique, which is what makes a retried submit safe.
      .onConflictDoNothing({ target: cashDeposits.depositReference })
      .returning({ id: cashDeposits.id });

    if (!created) return { ok: false, reason: 'DUPLICATE_REFERENCE' };

    return { ok: true, depositId: created.id };
  }

  async findDeposit(depositId: string): Promise<{
    id: string;
    driverId: string;
    declaredAmountPaise: number;
    verifiedAmountPaise: number | null;
    status: string;
    method: string;
    reference: string;
    declaredAt: Date;
  } | null> {
    const [row] = await this.db
      .select({
        id: cashDeposits.id,
        driverId: cashDeposits.driverId,
        declaredAmountPaise: cashDeposits.declaredAmountPaise,
        verifiedAmountPaise: cashDeposits.verifiedAmountPaise,
        status: cashDeposits.status,
        method: cashDeposits.method,
        reference: cashDeposits.depositReference,
        declaredAt: cashDeposits.declaredAt,
      })
      .from(cashDeposits)
      .where(eq(cashDeposits.id, depositId))
      .limit(1);

    return row
      ? {
          ...row,
          declaredAmountPaise: Number(row.declaredAmountPaise),
          verifiedAmountPaise:
            row.verifiedAmountPaise === null ? null : Number(row.verifiedAmountPaise),
        }
      : null;
  }

  async listDepositsForDriver(driverId: string, limit: number) {
    return this.db
      .select({
        id: cashDeposits.id,
        declaredAmountPaise: cashDeposits.declaredAmountPaise,
        verifiedAmountPaise: cashDeposits.verifiedAmountPaise,
        variancePaise: cashDeposits.variancePaise,
        status: cashDeposits.status,
        method: cashDeposits.method,
        reference: cashDeposits.depositReference,
        declaredAt: cashDeposits.declaredAt,
        verifiedAt: cashDeposits.verifiedAt,
        rejectionReason: cashDeposits.rejectionReason,
      })
      .from(cashDeposits)
      .where(eq(cashDeposits.driverId, driverId))
      .orderBy(desc(cashDeposits.declaredAt))
      .limit(limit);
  }

  /** The admin verification queue. Matches the partial index `cash_deposits_pending_idx`. */
  async listDepositsByStatus(
    status: 'DECLARED' | 'VERIFIED' | 'REJECTED' | 'PARTIAL',
    limit: number
  ) {
    return this.db
      .select({
        id: cashDeposits.id,
        driverId: cashDeposits.driverId,
        driverName: drivers.fullName,
        driverCode: drivers.driverCode,
        declaredAmountPaise: cashDeposits.declaredAmountPaise,
        verifiedAmountPaise: cashDeposits.verifiedAmountPaise,
        variancePaise: cashDeposits.variancePaise,
        status: cashDeposits.status,
        method: cashDeposits.method,
        reference: cashDeposits.depositReference,
        declaredAt: cashDeposits.declaredAt,
      })
      .from(cashDeposits)
      .innerJoin(drivers, eq(drivers.id, cashDeposits.driverId))
      .where(eq(cashDeposits.status, status))
      .orderBy(cashDeposits.declaredAt)
      .limit(limit);
  }

  /**
   * Verifies a deposit and writes the DEPOSIT ledger entry — in ONE transaction.
   *
   * This is the only thing that reduces a driver's cash in hand. The variance between what was
   * declared and what was counted is stored rather than resolved silently: a driver who
   * repeatedly declares more than they hand over is a pattern somebody needs to see.
   */
  async verifyDeposit(input: {
    depositId: string;
    verifiedAmountPaise: number;
    verifiedByUserId: string;
    notes: string | null;
  }): Promise<
    | { ok: true; variancePaise: number; driverId: string }
    | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_SETTLED' }
  > {
    return this.db.transaction(async (tx) => {
      const [deposit] = await tx
        .select({
          id: cashDeposits.id,
          driverId: cashDeposits.driverId,
          declaredAmountPaise: cashDeposits.declaredAmountPaise,
          status: cashDeposits.status,
        })
        .from(cashDeposits)
        // Locked, so two admins verifying the same deposit cannot both write a ledger entry and
        // halve the driver's float twice.
        .for('update')
        .where(eq(cashDeposits.id, input.depositId))
        .limit(1);

      if (!deposit) return { ok: false as const, reason: 'NOT_FOUND' as const };
      if (deposit.status !== 'DECLARED') {
        return { ok: false as const, reason: 'ALREADY_SETTLED' as const };
      }

      const declared = Number(deposit.declaredAmountPaise);
      const variance = declared - input.verifiedAmountPaise;
      const now = new Date();

      await tx
        .update(cashDeposits)
        .set({
          // PARTIAL when the counted amount does not match, so the queue keeps the distinction
          // between "settled cleanly" and "settled with a discrepancy".
          status: variance === 0 ? 'VERIFIED' : 'PARTIAL',
          verifiedAmountPaise: input.verifiedAmountPaise,
          variancePaise: variance,
          verifiedBy: input.verifiedByUserId,
          verifiedAt: now,
          notes: input.notes,
          updatedAt: now,
        })
        .where(eq(cashDeposits.id, deposit.id));

      /**
       * NEGATIVE, and only for what was actually COUNTED.
       *
       * Crediting the declared amount would let a driver reduce their float by declaring more
       * than they handed in — the exact hole the two-step exists to close.
       */
      await tx
        .insert(driverCashLedger)
        .values({
          driverId: deposit.driverId,
          entryType: 'DEPOSIT',
          amountPaise: -input.verifiedAmountPaise,
          cashDepositId: deposit.id,
          reason: variance === 0 ? 'Deposit verified' : 'Deposit verified with a variance',
          createdBy: input.verifiedByUserId,
        })
        .onConflictDoNothing();

      return { ok: true as const, variancePaise: variance, driverId: deposit.driverId };
    });
  }

  async rejectDeposit(input: {
    depositId: string;
    reason: string;
    verifiedByUserId: string;
  }): Promise<{ ok: boolean }> {
    const [updated] = await this.db
      .update(cashDeposits)
      .set({
        status: 'REJECTED',
        rejectionReason: input.reason,
        verifiedBy: input.verifiedByUserId,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      // Only a DECLARED deposit can be rejected: reversing a verified one would need a ledger
      // entry, which is an ADJUSTMENT and a different, audited decision.
      .where(and(eq(cashDeposits.id, input.depositId), eq(cashDeposits.status, 'DECLARED')))
      .returning({ id: cashDeposits.id });

    return { ok: Boolean(updated) };
  }

  /**
   * A manual correction: shortfall, write-off or fix.
   *
   * Always signed, always reasoned, always attributed. This is the only way to change a float
   * without a collection or a verified deposit, which is why `cash:adjust` is held by one role.
   */
  async recordAdjustment(input: {
    driverId: string;
    amountPaise: number;
    reason: string;
    createdByUserId: string;
    isWriteOff: boolean;
  }): Promise<{ id: string }> {
    const [driver] = await this.db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.id, input.driverId))
      .limit(1);

    if (!driver) throw new NotFoundError('That driver could not be found.');

    const [created] = await this.db
      .insert(driverCashLedger)
      .values({
        driverId: input.driverId,
        entryType: input.isWriteOff ? 'WRITE_OFF' : 'ADJUSTMENT',
        amountPaise: input.amountPaise,
        reason: input.reason,
        createdBy: input.createdByUserId,
      })
      .returning({ id: driverCashLedger.id });

    if (!created) throw new ConflictError('Could not record the adjustment.');
    return created;
  }

  /**
   * Cash in hand per driver, for the admin board.
   *
   * One grouped query rather than N re-sums: the alternative is a page that gets slower with
   * every driver hired.
   */
  async cashByDriver(limit: number): Promise<
    Array<{
      driverId: string;
      driverName: string;
      driverCode: string;
      cashInHandPaise: number;
      lastEntryAt: Date | null;
    }>
  > {
    const rows = await this.db
      .select({
        driverId: drivers.id,
        driverName: drivers.fullName,
        driverCode: drivers.driverCode,
        total: sql<string>`coalesce(sum(${driverCashLedger.amountPaise}), 0)`,
        lastEntryAt: sql<Date | null>`max(${driverCashLedger.createdAt})`,
      })
      .from(drivers)
      .leftJoin(driverCashLedger, eq(driverCashLedger.driverId, drivers.id))
      .groupBy(drivers.id, drivers.fullName, drivers.driverCode)
      .orderBy(desc(sql`coalesce(sum(${driverCashLedger.amountPaise}), 0)`))
      .limit(limit);

    return rows.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      driverCode: row.driverCode,
      cashInHandPaise: Number(row.total),
      lastEntryAt: row.lastEntryAt,
    }));
  }

  /**
   * Deliveries where the cash collected did not match what was expected.
   *
   * Matches the partial index `deliveries_cod_variance_idx`, so the report stays cheap however
   * many clean deliveries there are.
   */
  async listVariances(limit: number): Promise<
    Array<{
      deliveryId: string;
      orderNumber: string;
      driverName: string | null;
      expectedPaise: number | null;
      collectedPaise: number | null;
      variancePaise: number;
      collectedAt: Date | null;
    }>
  > {
    const rows = await this.db
      .select({
        deliveryId: deliveries.id,
        orderNumber: orders.orderNumber,
        driverName: drivers.fullName,
        expectedPaise: deliveries.codExpectedPaise,
        collectedPaise: deliveries.codCollectedPaise,
        variancePaise: deliveries.codVariancePaise,
        collectedAt: deliveries.codCollectedAt,
      })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .leftJoin(drivers, eq(drivers.id, deliveries.driverId))
      .where(and(isNotNull(deliveries.codVariancePaise), ne(deliveries.codVariancePaise, 0)))
      .orderBy(desc(deliveries.codCollectedAt))
      .limit(limit);

    return rows.map((row) => ({
      deliveryId: row.deliveryId,
      orderNumber: row.orderNumber,
      driverName: row.driverName,
      expectedPaise: row.expectedPaise === null ? null : Number(row.expectedPaise),
      collectedPaise: row.collectedPaise === null ? null : Number(row.collectedPaise),
      variancePaise: Number(row.variancePaise ?? 0),
      collectedAt: row.collectedAt,
    }));
  }

  /** Drivers over the configured float limit, for the dispatch exclusion report. */
  async driversOverLimit(limitPaise: number, take: number) {
    const all = await this.cashByDriver(take);
    return all.filter((driver) => driver.cashInHandPaise >= limitPaise);
  }

  /** Ledger entries an admin may need to inspect for one deposit. */
  async ledgerForDeposit(depositId: string) {
    return this.db
      .select({
        id: driverCashLedger.id,
        amountPaise: driverCashLedger.amountPaise,
        entryType: driverCashLedger.entryType,
      })
      .from(driverCashLedger)
      .where(eq(driverCashLedger.cashDepositId, depositId));
  }

  /** Used by the deposit form to refuse a declaration larger than the float. */
  async collectionTotals(driverId: string): Promise<{ collected: number; deposited: number }> {
    const rows = await this.db
      .select({
        entryType: driverCashLedger.entryType,
        total: sql<string>`coalesce(sum(${driverCashLedger.amountPaise}), 0)`,
      })
      .from(driverCashLedger)
      .where(
        and(
          eq(driverCashLedger.driverId, driverId),
          inArray(driverCashLedger.entryType, ['COLLECTION', 'DEPOSIT'])
        )
      )
      .groupBy(driverCashLedger.entryType);

    const find = (type: string) => Number(rows.find((row) => row.entryType === type)?.total ?? 0);
    return { collected: find('COLLECTION'), deposited: Math.abs(find('DEPOSIT')) };
  }
}

export function createCashRepository(context: RepositoryContext): DrizzleCashRepository {
  return new DrizzleCashRepository(context);
}
