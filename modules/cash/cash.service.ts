import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSetting } from '@/modules/settings';
import type { DrizzleCashRepository } from './cash.repository';

/**
 * Driver cash service (TASK 011b).
 *
 * Enforces the three rules that make a cash float trustworthy:
 *
 *   1. **Cash in hand is derived from the ledger**, never stored. One source of truth.
 *   2. **Declaring a deposit does not reduce it.** Only a verified count does, and only for the
 *      amount actually counted — otherwise a driver could zero their float with a form.
 *   3. **Over the limit means no more COD work**, and the driver is told so plainly (D-18).
 */

export interface CashServiceDeps {
  repository: DrizzleCashRepository;
}

export interface CashPositionView {
  cashInHandPaise: number;
  limitPaise: number;
  /** What is left before COD dispatch stops. Never negative. */
  headroomPaise: number;
  isCodBlocked: boolean;
  oldestUndepositedAt: Date | null;
  /** True once the oldest un-deposited cash is older than the configured grace period. */
  isOverdue: boolean;
  graceHours: number;
}

export class CashService {
  constructor(private readonly deps: CashServiceDeps) {}

  /**
   * Everything the driver's cash screen needs, in one read.
   *
   * `isCodBlocked` is computed here rather than in the UI so the dispatch filter and the screen
   * can never disagree — a driver being told they are fine while dispatch skips them is the worst
   * version of this feature.
   */
  async positionFor(driverId: string): Promise<CashPositionView> {
    const [limitPaise, graceHours, cashInHandPaise, oldestUndepositedAt] = await Promise.all([
      getSetting('cod.driver_cash_limit_paise'),
      getSetting('cod.deposit_grace_hours'),
      this.deps.repository.cashInHandPaise(driverId),
      this.deps.repository.oldestUndepositedAt(driverId),
    ]);

    const isOverdue =
      oldestUndepositedAt !== null &&
      Date.now() - oldestUndepositedAt.getTime() > graceHours * 60 * 60 * 1000;

    return {
      cashInHandPaise,
      limitPaise,
      headroomPaise: Math.max(0, limitPaise - cashInHandPaise),
      isCodBlocked: cashInHandPaise >= limitPaise,
      oldestUndepositedAt,
      isOverdue,
      graceHours,
    };
  }

  async ledgerFor(driverId: string, page: { limit: number; cursor?: string | undefined }) {
    return this.deps.repository.listLedger(driverId, page);
  }

  async depositsFor(driverId: string, limit = 20) {
    return this.deps.repository.listDepositsForDriver(driverId, limit);
  }

  /**
   * Declares a deposit. Status `DECLARED`; the float does not move yet.
   *
   * Refuses an amount larger than what the driver is actually holding — not to be pedantic, but
   * because the only ways that number can exceed the float are a typo or an attempt to
   * manufacture a credit, and both are better refused at the door.
   */
  async declareDeposit(input: {
    driverId: string;
    declaredAmountPaise: number;
    method: 'BANK_TRANSFER' | 'OFFICE_CASH' | 'UPI';
    reference?: string | null;
    proofKey?: string | null;
    idempotencyKey: string;
  }): Promise<{ depositId: string; wasReplay: boolean }> {
    if (input.declaredAmountPaise <= 0) {
      // Also a CHECK constraint on the table; refused here so the error is a sentence rather than
      // a database violation.
      throw new ValidationError('Enter the amount you are depositing.');
    }

    const inHand = await this.deps.repository.cashInHandPaise(input.driverId);

    if (input.declaredAmountPaise > inHand) {
      throw new BusinessRuleError(
        'DEPOSIT_AMOUNT_INVALID',
        'That is more than the cash recorded against your account. Check the amount, or contact support if it looks wrong.',
        { details: { cashInHandPaise: inHand } }
      );
    }

    /**
     * The reference is the idempotency key.
     *
     * `cash_deposits_reference_key` is unique, so a driver double-tapping "declare" on a flaky
     * connection produces one deposit, not two — and two deposits would be counted twice by the
     * admin who verifies them.
     */
    const reference = input.reference?.trim() || `dep-${input.idempotencyKey}`;

    const result = await this.deps.repository.declareDeposit({
      driverId: input.driverId,
      declaredAmountPaise: input.declaredAmountPaise,
      method: input.method,
      reference,
      proofKey: input.proofKey ?? null,
      notes: null,
    });

    if (!result.ok) {
      const existing = await this.deps.repository
        .listDepositsForDriver(input.driverId, 20)
        .then((rows) => rows.find((row) => row.reference === reference));

      if (existing) return { depositId: existing.id, wasReplay: true };

      throw new ConflictError('That deposit reference has already been used.');
    }

    logger.info('Cash deposit declared', {
      driverId: input.driverId,
      depositId: result.depositId,
      declaredAmountPaise: input.declaredAmountPaise,
    });

    return { depositId: result.depositId, wasReplay: false };
  }

  async verificationQueue(status: 'DECLARED' | 'VERIFIED' | 'REJECTED' | 'PARTIAL', limit = 50) {
    return this.deps.repository.listDepositsByStatus(status, limit);
  }

  /**
   * Verifies a deposit: the only thing that reduces a driver's float.
   *
   * A variance is recorded, not resolved. Someone has to decide whether a short deposit is a
   * counting error or a shortfall, and that decision is an `ADJUSTMENT` with a reason attached.
   */
  async verifyDeposit(input: {
    depositId: string;
    verifiedAmountPaise: number;
    verifiedByUserId: string;
    notes?: string | null;
  }): Promise<{ variancePaise: number; driverId: string }> {
    if (input.verifiedAmountPaise < 0) {
      throw new ValidationError('A verified amount cannot be negative.');
    }

    const result = await this.deps.repository.verifyDeposit({
      depositId: input.depositId,
      verifiedAmountPaise: input.verifiedAmountPaise,
      verifiedByUserId: input.verifiedByUserId,
      notes: input.notes ?? null,
    });

    if (!result.ok) {
      if (result.reason === 'NOT_FOUND')
        throw new NotFoundError('That deposit could not be found.');
      // Verifying twice would write a second negative ledger entry and halve the float again.
      throw new BusinessRuleError(
        'DEPOSIT_ALREADY_VERIFIED',
        'This deposit has already been settled.'
      );
    }

    if (result.variancePaise !== 0) {
      logger.warn('Cash deposit verified with a variance', {
        depositId: input.depositId,
        variancePaise: result.variancePaise,
      });
    }

    return { variancePaise: result.variancePaise, driverId: result.driverId };
  }

  async rejectDeposit(input: {
    depositId: string;
    reason: string;
    verifiedByUserId: string;
  }): Promise<void> {
    const result = await this.deps.repository.rejectDeposit(input);

    if (!result.ok) {
      throw new BusinessRuleError(
        'DEPOSIT_ALREADY_VERIFIED',
        'Only a declared deposit can be rejected. A settled one needs an adjustment instead.'
      );
    }
  }

  /**
   * A signed correction to a driver's float.
   *
   * Negative writes cash off; positive adds it back. Held behind `cash:adjust` — one role — for
   * exactly the reason it looks convenient: it is the one operation that can make a discrepancy
   * disappear without anyone counting money.
   */
  async recordAdjustment(input: {
    driverId: string;
    amountPaise: number;
    reason: string;
    createdByUserId: string;
    isWriteOff?: boolean;
  }): Promise<{ id: string; cashInHandPaise: number }> {
    if (input.amountPaise === 0) {
      throw new ValidationError('An adjustment of zero changes nothing.');
    }

    if (input.reason.trim().length < 3) {
      // The reason IS the audit trail. An adjustment nobody can explain later is indistinguishable
      // from cash going missing.
      throw new ValidationError('A reason is required for a cash adjustment.');
    }

    const created = await this.deps.repository.recordAdjustment({
      driverId: input.driverId,
      amountPaise: input.amountPaise,
      reason: input.reason.trim(),
      createdByUserId: input.createdByUserId,
      isWriteOff: input.isWriteOff ?? false,
    });

    logger.warn('Driver cash adjusted', {
      driverId: input.driverId,
      amountPaise: input.amountPaise,
      by: input.createdByUserId,
    });

    return {
      id: created.id,
      cashInHandPaise: await this.deps.repository.cashInHandPaise(input.driverId),
    };
  }

  /** The admin board: who is holding what, and who is over the limit. */
  async adminOverview(limit = 100): Promise<{
    limitPaise: number;
    drivers: Array<{
      driverId: string;
      driverName: string;
      driverCode: string;
      cashInHandPaise: number;
      lastEntryAt: Date | null;
      isOverLimit: boolean;
    }>;
    overLimitCount: number;
    totalOutstandingPaise: number;
  }> {
    const [limitPaise, rows] = await Promise.all([
      getSetting('cod.driver_cash_limit_paise'),
      this.deps.repository.cashByDriver(limit),
    ]);

    const drivers = rows.map((row) => ({
      ...row,
      isOverLimit: row.cashInHandPaise >= limitPaise,
    }));

    return {
      limitPaise,
      drivers,
      overLimitCount: drivers.filter((driver) => driver.isOverLimit).length,
      // The platform's exposure: how much of its money is currently in drivers' pockets.
      totalOutstandingPaise: drivers.reduce((sum, driver) => sum + driver.cashInHandPaise, 0),
    };
  }

  async variances(limit = 50) {
    return this.deps.repository.listVariances(limit);
  }

  /** Injected into the delivery service, so dispatch and this screen share one definition. */
  cashInHandPaise(driverId: string): Promise<number> {
    return this.deps.repository.cashInHandPaise(driverId);
  }
}

export function createCashService(deps: CashServiceDeps): CashService {
  return new CashService(deps);
}
