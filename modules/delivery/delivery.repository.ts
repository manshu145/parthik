import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  deliveries,
  deliveryAssignments,
  deliveryProofs,
  deliveryStatusHistory,
  driverCashLedger,
  drivers,
  orders,
  stores,
} from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { applyOrderTransitionInTx, requireTransition, type OrderStatus } from '@/modules/order';
import { MAX_OTP_ATTEMPTS, MAX_OTP_REGENERATIONS, otpHashesMatch } from './delivery.otp';
import type {
  CompleteDeliveryInput,
  CompleteDeliveryResult,
  CreateDeliveryInput,
  DeliveryRecord,
  DeliveryRepository,
  DeliveryStatus,
  DeliveryTransitionOutcome,
  DeliveryWithOrder,
  DriverAvailability,
  DriverRecord,
  StoreForDelivery,
} from './delivery.repository.types';

/**
 * Drizzle delivery repository.
 *
 * THE FUNCTION TO READ FIRST IS `complete`. It is the only place in the codebase where a
 * physical event (someone handed over a bag and took cash) becomes five database facts, and it
 * does all five in ONE transaction:
 *
 *   1. the OTP is verified — the evidence that a human actually received the order
 *   2. the delivery is DELIVERED, with the cash actually collected and any variance
 *   3. the ORDER moves to DELIVERED through the state machine, which converts the stock
 *      reservation into a sale and marks the COD payment paid
 *   4. a proof row records that the handover was confirmed by OTP
 *   5. the driver's cash ledger gains a COLLECTION entry
 *
 * Splitting them would produce a delivered order whose stock was never consumed, or cash in a
 * driver's pocket with no ledger row — and the second one is indistinguishable from theft.
 */
export class DrizzleDeliveryRepository implements DeliveryRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  async findStoreForDelivery(storeId: string): Promise<StoreForDelivery | null> {
    const [row] = await this.db
      .select({
        id: stores.id,
        name: stores.name,
        line1: stores.line1,
        city: stores.city,
        pincode: stores.pincode,
        latitude: stores.latitude,
        longitude: stores.longitude,
      })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    return row
      ? {
          id: row.id,
          name: row.name,
          line1: row.line1,
          city: row.city,
          pincode: row.pincode,
          latitude: row.latitude ?? null,
          longitude: row.longitude ?? null,
        }
      : null;
  }

  async findDriverByUserId(userId: string): Promise<DriverRecord | null> {
    const [row] = await this.db
      .select(driverColumns)
      .from(drivers)
      .where(and(eq(drivers.userId, userId), isNull(drivers.deletedAt)))
      .limit(1);

    return row ? mapDriver(row) : null;
  }

  async findDriverById(driverId: string): Promise<DriverRecord | null> {
    const [row] = await this.db
      .select(driverColumns)
      .from(drivers)
      .where(and(eq(drivers.id, driverId), isNull(drivers.deletedAt)))
      .limit(1);

    return row ? mapDriver(row) : null;
  }

  async setAvailability(driverId: string, availability: DriverAvailability): Promise<void> {
    await this.db
      .update(drivers)
      .set({
        availability,
        /**
         * Going OFFLINE DELETES the position (D-29, C-1).
         *
         * Location is collected to dispatch work, so it is kept only while the driver is
         * working. Retaining it afterwards would turn an operational signal into a movement
         * history nobody agreed to.
         */
        ...(availability === 'OFFLINE'
          ? { currentLatitude: null, currentLongitude: null, locationUpdatedAt: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId));
  }

  async updateDriverLocation(
    driverId: string,
    position: { latitude: number; longitude: number }
  ): Promise<void> {
    // Overwritten, never appended. The dispatch position is the latest one, and a per-ping row
    // would build exactly the history C-1 forbids.
    await this.db
      .update(drivers)
      .set({
        currentLatitude: position.latitude.toFixed(6),
        currentLongitude: position.longitude.toFixed(6),
        locationUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId));
  }

  async createForOrder(
    input: CreateDeliveryInput
  ): Promise<{ delivery: DeliveryRecord; created: boolean }> {
    /**
     * `onConflictDoNothing` on the unique `order_id`.
     *
     * Dispatch is triggered by a vendor action, which means it can be triggered twice — a
     * double-click, a retried queue message. Two deliveries for one order would send two
     * drivers to the same store, so the database refuses rather than the code remembering to.
     */
    const [inserted] = await this.db
      .insert(deliveries)
      .values({
        orderId: input.orderId,
        storeId: input.storeId,
        deliveryZoneId: input.deliveryZoneId,
        status: 'PENDING_ASSIGNMENT',
        pickupAddressSnapshot: input.pickupAddressSnapshot,
        dropAddressSnapshot: input.dropAddressSnapshot,
        deliveryFeePaise: input.deliveryFeePaise,
        codExpectedPaise: input.codExpectedPaise,
        deliveryOtpHash: input.otpHash,
      })
      .onConflictDoNothing({ target: deliveries.orderId })
      .returning(deliveryColumns);

    if (inserted) {
      await this.db.insert(deliveryStatusHistory).values({
        deliveryId: inserted.id,
        fromStatus: null,
        toStatus: 'PENDING_ASSIGNMENT',
        changedByRole: 'SYSTEM',
        reason: 'Order ready for pickup',
      });

      return { delivery: mapDelivery(inserted), created: true };
    }

    const existing = await this.findByOrderId(input.orderId);
    if (!existing) throw new ConflictError('Could not create the delivery.');

    return { delivery: existing.delivery, created: false };
  }

  async findById(deliveryId: string): Promise<DeliveryWithOrder | null> {
    return this.findOne(eq(deliveries.id, deliveryId));
  }

  async findByOrderId(orderId: string): Promise<DeliveryWithOrder | null> {
    return this.findOne(eq(deliveries.orderId, orderId));
  }

  async findActiveForDriver(driverId: string): Promise<DeliveryWithOrder | null> {
    return this.findOne(
      and(
        eq(deliveries.driverId, driverId),
        inArray(deliveries.status, [
          'ASSIGNED',
          'EN_ROUTE_TO_STORE',
          'AT_STORE',
          'PICKED_UP',
          'EN_ROUTE_TO_CUSTOMER',
          'AT_CUSTOMER',
        ])
      )
    );
  }

  async listForDriver(
    driverId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{ items: DeliveryWithOrder[]; nextCursor: string | null }> {
    const cursorDate = page.cursor ? new Date(page.cursor) : null;

    const rows = await this.db
      .select({ delivery: deliveryColumns, order: orderFacts })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(
        cursorDate
          ? and(eq(deliveries.driverId, driverId), lt(deliveries.createdAt, cursorDate))
          : eq(deliveries.driverId, driverId)
      )
      .orderBy(desc(deliveries.createdAt))
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const items = (hasMore ? rows.slice(0, page.limit) : rows).map(mapJoined);

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.delivery.createdAt.toISOString() ?? null) : null,
    };
  }

  async listAwaitingAssignment(limit: number): Promise<DeliveryWithOrder[]> {
    const rows = await this.db
      .select({ delivery: deliveryColumns, order: orderFacts })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      // Matches the partial index `deliveries_pending_idx`. Oldest first: a delivery that has
      // been waiting longest is the one closest to breaking its promise.
      .where(inArray(deliveries.status, ['PENDING_ASSIGNMENT', 'OFFERED']))
      .orderBy(asc(deliveries.createdAt))
      .limit(limit);

    return rows.map(mapJoined);
  }

  async claim(input: {
    deliveryId: string;
    driverId: string;
    actorUserId: string | null;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      /**
       * A CONDITIONAL UPDATE, not a read followed by a write.
       *
       * `where driver_id is null and status in (...)` means the database decides the winner of a
       * race between two drivers tapping "accept" at the same moment. Reading first and then
       * writing would let both pass the check and both be told they had the job.
       */
      const [claimed] = await tx
        .update(deliveries)
        .set({
          driverId: input.driverId,
          status: 'ASSIGNED',
          assignedAt: new Date(),
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(deliveries.id, input.deliveryId),
            isNull(deliveries.driverId),
            inArray(deliveries.status, ['PENDING_ASSIGNMENT', 'OFFERED'])
          )
        )
        .returning({ id: deliveries.id, orderId: deliveries.orderId });

      if (!claimed) return false;

      await tx.insert(deliveryStatusHistory).values({
        deliveryId: claimed.id,
        fromStatus: 'PENDING_ASSIGNMENT',
        toStatus: 'ASSIGNED',
        changedByUserId: input.actorUserId,
        changedByRole: 'DRIVER',
      });

      // The attempt number is unique per delivery, so a re-offer after a decline gets its own row
      // rather than overwriting the history of who was asked.
      const attempts = await tx
        .select({ id: deliveryAssignments.id })
        .from(deliveryAssignments)
        .where(eq(deliveryAssignments.deliveryId, claimed.id));

      await tx.insert(deliveryAssignments).values({
        deliveryId: claimed.id,
        driverId: input.driverId,
        response: 'ACCEPTED',
        respondedAt: new Date(),
        attemptNumber: attempts.length + 1,
        dispatchMode: input.actorUserId === null ? 'AUTO_NEAREST' : 'MANUAL',
        assignedBy: input.actorUserId,
      });

      /**
       * The ORDER moves too, in the same transaction.
       *
       * READY_FOR_PICKUP -> ASSIGNED is a SYSTEM transition: the customer's tracker should show
       * "driver assigned" the moment it is true, not whenever a separate job next runs.
       */
      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, claimed.orderId))
        .for('update')
        .limit(1);

      if (order && (order.status as OrderStatus) === 'READY_FOR_PICKUP') {
        const rule = requireTransition('READY_FOR_PICKUP', 'ASSIGNED', 'SYSTEM');

        await applyOrderTransitionInTx(tx, {
          orderId: order.id,
          from: 'READY_FOR_PICKUP',
          to: 'ASSIGNED',
          actor: 'SYSTEM',
          actorUserId: input.actorUserId,
          reason: 'Driver assigned',
          effects: rule.effects,
        });
      }

      // Marked busy so dispatch stops offering them work they cannot take.
      await tx
        .update(drivers)
        .set({ availability: 'ON_DELIVERY', updatedAt: new Date() })
        .where(and(eq(drivers.id, input.driverId), eq(drivers.availability, 'ONLINE')));

      return true;
    });
  }

  async recordDecline(input: {
    deliveryId: string;
    driverId: string;
    reason: string | null;
  }): Promise<void> {
    const attempts = await this.db
      .select({ id: deliveryAssignments.id })
      .from(deliveryAssignments)
      .where(eq(deliveryAssignments.deliveryId, input.deliveryId));

    await this.db.insert(deliveryAssignments).values({
      deliveryId: input.deliveryId,
      driverId: input.driverId,
      response: 'DECLINED',
      respondedAt: new Date(),
      declineReason: input.reason,
      attemptNumber: attempts.length + 1,
    });
  }

  async advance(input: {
    deliveryId: string;
    driverId: string;
    from: DeliveryStatus[];
    to: DeliveryStatus;
    actorUserId: string;
    position?: { latitude: number; longitude: number } | undefined;
    reason?: string | null;
  }): Promise<DeliveryTransitionOutcome> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: deliveries.id, status: deliveries.status, orderId: deliveries.orderId })
        .from(deliveries)
        .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.driverId, input.driverId)))
        .for('update')
        .limit(1);

      if (!current) throw new NotFoundError('That delivery could not be found.');

      const status = current.status as DeliveryStatus;
      // Idempotent: a driver tapping "arrived" twice on a flaky connection is not an error.
      if (status === input.to) return 'ALREADY_THERE';
      if (!input.from.includes(status)) return 'STALE';

      await tx
        .update(deliveries)
        .set({
          status: input.to,
          ...(input.to === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}),
          ...(input.to === 'AT_STORE' ? { reachedStoreAt: new Date() } : {}),
          ...(input.to === 'AT_CUSTOMER' ? { reachedCustomerAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(deliveries.id, current.id));

      await tx.insert(deliveryStatusHistory).values({
        deliveryId: current.id,
        fromStatus: status,
        toStatus: input.to,
        changedByUserId: input.actorUserId,
        changedByRole: 'DRIVER',
        reason: input.reason ?? null,
        /**
         * Coordinates are stored ONLY on an active delivery's trail, and purged after 7 days by
         * the job that reads `delivery_status_history_purge_idx` (C-1).
         */
        ...(input.position
          ? {
              latitude: input.position.latitude.toFixed(6),
              longitude: input.position.longitude.toFixed(6),
            }
          : {}),
      });

      // ---- Keep the ORDER in step ----
      const orderTarget = ORDER_STATUS_FOR_DELIVERY[input.to];

      if (orderTarget) {
        const [order] = await tx
          .select({ id: orders.id, status: orders.status })
          .from(orders)
          .where(eq(orders.id, current.orderId))
          .for('update')
          .limit(1);

        const orderStatus = order?.status as OrderStatus | undefined;

        if (order && orderStatus && orderStatus !== orderTarget) {
          // Only when the state machine actually permits it; a delivery step that cannot move
          // the order is not a failure, it just means the order is already ahead.
          try {
            const rule = requireTransition(orderStatus, orderTarget, 'DRIVER');

            await applyOrderTransitionInTx(tx, {
              orderId: order.id,
              from: orderStatus,
              to: orderTarget,
              actor: 'DRIVER',
              actorUserId: input.actorUserId,
              reason: null,
              effects: rule.effects,
            });
          } catch {
            logger.info('Delivery step did not move the order', {
              deliveryId: current.id,
              deliveryStatus: input.to,
              orderStatus,
            });
          }
        }
      }

      return 'MOVED';
    });
  }

  async complete(input: CompleteDeliveryInput): Promise<CompleteDeliveryResult> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: deliveries.id,
          orderId: deliveries.orderId,
          status: deliveries.status,
          otpHash: deliveries.deliveryOtpHash,
          otpAttempts: deliveries.otpAttempts,
          codExpectedPaise: deliveries.codExpectedPaise,
        })
        .from(deliveries)
        .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.driverId, input.driverId)))
        // Locked so two submissions of the same OTP cannot both pass the attempt check.
        .for('update')
        .limit(1);

      if (!current) throw new NotFoundError('That delivery could not be found.');

      const status = current.status as DeliveryStatus;
      if (status === 'DELIVERED')
        return { ok: false as const, reason: 'ALREADY_DELIVERED' as const };

      if (!['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'AT_CUSTOMER'].includes(status)) {
        // Delivering something never picked up would consume stock that is still on the shelf.
        return { ok: false as const, reason: 'WRONG_STATUS' as const, status };
      }

      if (current.otpAttempts >= MAX_OTP_ATTEMPTS) {
        return { ok: false as const, reason: 'OTP_LOCKED' as const };
      }

      if (!otpHashesMatch(current.otpHash, input.submittedOtpHash)) {
        /**
         * The attempt is counted INSIDE the transaction that rejected it.
         *
         * Counting it afterwards, outside, would let a caller that abandons the request retry
         * indefinitely — which is the whole attack the cap exists to stop.
         */
        const attempts = current.otpAttempts + 1;

        await tx
          .update(deliveries)
          .set({ otpAttempts: attempts, updatedAt: new Date() })
          .where(eq(deliveries.id, current.id));

        return {
          ok: false as const,
          reason: 'OTP_INVALID' as const,
          attemptsRemaining: Math.max(0, MAX_OTP_ATTEMPTS - attempts),
        };
      }

      const now = new Date();
      const expected = current.codExpectedPaise === null ? null : Number(current.codExpectedPaise);
      const collected = input.codCollectedPaise;

      /**
       * The variance is RECORDED, and the delivery still completes.
       *
       * A ₹10 shortfall must not strand the customer on the doorstep while the driver argues
       * about it — but it must not vanish either, or COD reconciliation becomes guesswork. So the
       * gap is stored, the delivery finishes, and the caller reports it as a warning
       * (docs/API_SPEC.md §6.1).
       */
      const variance = expected !== null && collected !== null ? expected - collected : 0;

      await tx
        .update(deliveries)
        .set({
          status: 'DELIVERED',
          otpVerifiedAt: now,
          deliveredAt: now,
          ...(collected !== null
            ? {
                codCollectedPaise: collected,
                codCollectionMethod: 'CASH' as const,
                codCollectedAt: now,
                codVariancePaise: variance,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(deliveries.id, current.id));

      await tx.insert(deliveryStatusHistory).values({
        deliveryId: current.id,
        fromStatus: status,
        toStatus: 'DELIVERED',
        changedByUserId: input.actorUserId,
        changedByRole: 'DRIVER',
      });

      /**
       * The proof row is the audit trail for the handover.
       *
       * `OTP` is the primary path; a photo key, when present, is an EXCEPTION and is reportable
       * separately through `delivery_proofs_exception_idx` (D-20).
       */
      await tx.insert(deliveryProofs).values({
        deliveryId: current.id,
        proofType: input.proofStorageKey ? 'PHOTO' : 'OTP',
        storageKey: input.proofStorageKey,
        otpVerified: true,
        recipientName: input.recipientName,
        capturedAt: now,
      });

      // ---- The order, its stock and its payment ----
      const [order] = await tx
        .select({ id: orders.id, status: orders.status, isCod: orders.isCod })
        .from(orders)
        .where(eq(orders.id, current.orderId))
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundError('That order could not be found.');

      const orderStatus = order.status as OrderStatus;

      if (orderStatus !== 'DELIVERED') {
        // CONSUME_STOCK and COLLECT_COD come from the transition table, so this path cannot
        // forget either one.
        const from: OrderStatus = orderStatus === 'PICKED_UP' ? 'PICKED_UP' : orderStatus;
        const rule = requireTransition(
          from === 'PICKED_UP' ? 'PICKED_UP' : 'OUT_FOR_DELIVERY',
          from === 'PICKED_UP' ? 'OUT_FOR_DELIVERY' : 'DELIVERED',
          'DRIVER'
        );

        // A driver who never tapped "on my way" still delivered the order. Rather than refusing,
        // walk the missing step first so the history stays gapless.
        if (from === 'PICKED_UP') {
          await applyOrderTransitionInTx(tx, {
            orderId: order.id,
            from: 'PICKED_UP',
            to: 'OUT_FOR_DELIVERY',
            actor: 'DRIVER',
            actorUserId: input.actorUserId,
            reason: 'Delivered without a separate dispatch step',
            effects: rule.effects,
          });
        }

        const deliverRule = requireTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'DRIVER');

        await applyOrderTransitionInTx(tx, {
          orderId: order.id,
          from: 'OUT_FOR_DELIVERY',
          to: 'DELIVERED',
          actor: 'DRIVER',
          actorUserId: input.actorUserId,
          reason: null,
          effects: deliverRule.effects,
        });
      }

      /**
       * ---- The driver's cash ledger ----
       *
       * The last of the five facts, and the one that was missing until this module existed:
       * `COLLECT_COD` marked the payment paid but nothing recorded that a driver is now holding
       * the customer's money. Cash in hand is DERIVED from this table, so a missing row is cash
       * that cannot be reconciled — indistinguishable from cash that was never handed over.
       *
       * `driver_cash_ledger_collection_key` is unique on (delivery_id, COLLECTION), so a retried
       * deliver call is refused by the database rather than double-counting the float.
       */
      if (order.isCod && collected !== null && collected > 0) {
        await tx
          .insert(driverCashLedger)
          .values({
            driverId: input.driverId,
            entryType: 'COLLECTION',
            // Positive: the driver's float goes UP when they take cash.
            amountPaise: collected,
            deliveryId: current.id,
            orderId: order.id,
            reason: 'Cash collected on delivery',
            createdBy: input.actorUserId,
          })
          .onConflictDoNothing();
      }

      // Free to take more work.
      await tx
        .update(drivers)
        .set({
          availability: 'ONLINE',
          totalDeliveries: sql`${drivers.totalDeliveries} + 1`,
          successfulDeliveries: sql`${drivers.successfulDeliveries} + 1`,
          updatedAt: now,
        })
        .where(eq(drivers.id, input.driverId));

      return {
        ok: true as const,
        codVariancePaise: variance,
        codCollectedPaise: collected,
      };
    });
  }

  async fail(input: {
    deliveryId: string;
    driverId: string;
    reason: string;
    actorUserId: string;
  }): Promise<DeliveryTransitionOutcome> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: deliveries.id, status: deliveries.status, orderId: deliveries.orderId })
        .from(deliveries)
        .where(and(eq(deliveries.id, input.deliveryId), eq(deliveries.driverId, input.driverId)))
        .for('update')
        .limit(1);

      if (!current) throw new NotFoundError('That delivery could not be found.');

      const status = current.status as DeliveryStatus;
      if (status === 'FAILED') return 'ALREADY_THERE';
      if (status === 'DELIVERED') return 'STALE';

      const now = new Date();

      await tx
        .update(deliveries)
        .set({ status: 'FAILED', failedAt: now, failureReason: input.reason, updatedAt: now })
        .where(eq(deliveries.id, current.id));

      await tx.insert(deliveryStatusHistory).values({
        deliveryId: current.id,
        fromStatus: status,
        toStatus: 'FAILED',
        changedByUserId: input.actorUserId,
        changedByRole: 'DRIVER',
        reason: input.reason,
      });

      const [order] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, current.orderId))
        .for('update')
        .limit(1);

      const orderStatus = order?.status as OrderStatus | undefined;

      /**
       * FAILED_DELIVERY, not CANCELLED.
       *
       * The stock stays reserved and the payment stays as it is, because the goods are in a
       * driver's bag rather than back on a shelf — only an admin decides whether it is retried,
       * returned or refunded.
       */
      if (order && (orderStatus === 'PICKED_UP' || orderStatus === 'OUT_FOR_DELIVERY')) {
        const rule = requireTransition(orderStatus, 'FAILED_DELIVERY', 'DRIVER');

        await applyOrderTransitionInTx(tx, {
          orderId: order.id,
          from: orderStatus,
          to: 'FAILED_DELIVERY',
          actor: 'DRIVER',
          actorUserId: input.actorUserId,
          reason: input.reason,
          effects: rule.effects,
        });
      }

      await tx
        .update(drivers)
        .set({
          availability: 'ONLINE',
          totalDeliveries: sql`${drivers.totalDeliveries} + 1`,
          updatedAt: now,
        })
        .where(eq(drivers.id, input.driverId));

      return 'MOVED';
    });
  }

  async regenerateOtp(input: {
    deliveryId: string;
    otpHash: string;
  }): Promise<
    { ok: true } | { ok: false; reason: 'TOO_MANY' | 'NOT_FOUND' | 'ALREADY_DELIVERED' }
  > {
    const [current] = await this.db
      .select({
        id: deliveries.id,
        status: deliveries.status,
        regenerations: deliveries.otpRegeneratedCount,
      })
      .from(deliveries)
      .where(eq(deliveries.id, input.deliveryId))
      .limit(1);

    if (!current) return { ok: false, reason: 'NOT_FOUND' };
    if ((current.status as DeliveryStatus) === 'DELIVERED') {
      return { ok: false, reason: 'ALREADY_DELIVERED' };
    }
    if (current.regenerations >= MAX_OTP_REGENERATIONS) return { ok: false, reason: 'TOO_MANY' };

    await this.db
      .update(deliveries)
      .set({
        deliveryOtpHash: input.otpHash,
        otpRegeneratedCount: current.regenerations + 1,
        // The attempt counter resets with the code: the driver is now typing a different number,
        // and holding failures from the old one against them would lock a valid delivery.
        otpAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, current.id));

    return { ok: true };
  }

  private async findOne(
    where: ReturnType<typeof eq> | undefined
  ): Promise<DeliveryWithOrder | null> {
    const [row] = await this.db
      .select({ delivery: deliveryColumns, order: orderFacts })
      .from(deliveries)
      .innerJoin(orders, eq(orders.id, deliveries.orderId))
      .where(where)
      .limit(1);

    return row ? mapJoined(row) : null;
  }
}

/**
 * Which ORDER status each delivery step implies.
 *
 * Declared as a table for the same reason the order transitions are: a driver tapping through
 * their screen must move the customer's order in lockstep, and scattering that mapping across
 * five handlers is how the two drift apart.
 */
const ORDER_STATUS_FOR_DELIVERY: Partial<Record<DeliveryStatus, OrderStatus>> = {
  PICKED_UP: 'PICKED_UP',
  EN_ROUTE_TO_CUSTOMER: 'OUT_FOR_DELIVERY',
};

const driverColumns = {
  id: drivers.id,
  userId: drivers.userId,
  driverCode: drivers.driverCode,
  status: drivers.status,
  availability: drivers.availability,
  fullName: drivers.fullName,
  phone: drivers.phone,
  currentLatitude: drivers.currentLatitude,
  currentLongitude: drivers.currentLongitude,
} as const;

const deliveryColumns = {
  id: deliveries.id,
  orderId: deliveries.orderId,
  storeId: deliveries.storeId,
  driverId: deliveries.driverId,
  status: deliveries.status,
  deliveryZoneId: deliveries.deliveryZoneId,
  pickupAddressSnapshot: deliveries.pickupAddressSnapshot,
  dropAddressSnapshot: deliveries.dropAddressSnapshot,
  deliveryFeePaise: deliveries.deliveryFeePaise,
  otpVerifiedAt: deliveries.otpVerifiedAt,
  otpAttempts: deliveries.otpAttempts,
  otpRegeneratedCount: deliveries.otpRegeneratedCount,
  assignedAt: deliveries.assignedAt,
  pickedUpAt: deliveries.pickedUpAt,
  deliveredAt: deliveries.deliveredAt,
  failedAt: deliveries.failedAt,
  failureReason: deliveries.failureReason,
  codExpectedPaise: deliveries.codExpectedPaise,
  codCollectedPaise: deliveries.codCollectedPaise,
  codVariancePaise: deliveries.codVariancePaise,
  createdAt: deliveries.createdAt,
} as const;

const orderFacts = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  userId: orders.userId,
  status: orders.status,
  isCod: orders.isCod,
  codAmountPaise: orders.codAmountPaise,
  totalAmountPaise: orders.totalAmountPaise,
  contactName: orders.contactName,
  contactPhone: orders.contactPhone,
  vendorId: orders.vendorId,
} as const;

type DeliveryRow = { [K in keyof typeof deliveryColumns]: unknown };

function mapDelivery(row: DeliveryRow): DeliveryRecord {
  return {
    id: row.id as string,
    orderId: row.orderId as string,
    storeId: row.storeId as string,
    driverId: (row.driverId as string | null) ?? null,
    status: row.status as DeliveryStatus,
    deliveryZoneId: (row.deliveryZoneId as string | null) ?? null,
    pickupAddressSnapshot: (row.pickupAddressSnapshot as Record<string, unknown>) ?? {},
    dropAddressSnapshot: (row.dropAddressSnapshot as Record<string, unknown>) ?? {},
    deliveryFeePaise: Number(row.deliveryFeePaise ?? 0),
    otpVerifiedAt: (row.otpVerifiedAt as Date | null) ?? null,
    otpAttempts: Number(row.otpAttempts ?? 0),
    otpRegeneratedCount: Number(row.otpRegeneratedCount ?? 0),
    assignedAt: (row.assignedAt as Date | null) ?? null,
    pickedUpAt: (row.pickedUpAt as Date | null) ?? null,
    deliveredAt: (row.deliveredAt as Date | null) ?? null,
    failedAt: (row.failedAt as Date | null) ?? null,
    failureReason: (row.failureReason as string | null) ?? null,
    codExpectedPaise: row.codExpectedPaise === null ? null : Number(row.codExpectedPaise),
    codCollectedPaise: row.codCollectedPaise === null ? null : Number(row.codCollectedPaise),
    codVariancePaise: row.codVariancePaise === null ? null : Number(row.codVariancePaise),
    createdAt: row.createdAt as Date,
  };
}

function mapDriver(row: { [K in keyof typeof driverColumns]: unknown }): DriverRecord {
  return {
    id: row.id as string,
    userId: row.userId as string,
    driverCode: row.driverCode as string,
    status: row.status as string,
    availability: row.availability as DriverAvailability,
    fullName: row.fullName as string,
    phone: row.phone as string,
    currentLatitude: (row.currentLatitude as string | null) ?? null,
    currentLongitude: (row.currentLongitude as string | null) ?? null,
  };
}

function mapJoined(row: {
  delivery: DeliveryRow;
  order: { [K in keyof typeof orderFacts]: unknown };
}): DeliveryWithOrder {
  return {
    delivery: mapDelivery(row.delivery),
    order: {
      id: row.order.id as string,
      orderNumber: row.order.orderNumber as string,
      userId: row.order.userId as string,
      status: row.order.status as OrderStatus,
      isCod: row.order.isCod as boolean,
      codAmountPaise: row.order.codAmountPaise === null ? null : Number(row.order.codAmountPaise),
      totalAmountPaise: Number(row.order.totalAmountPaise),
      contactName: row.order.contactName as string,
      contactPhone: row.order.contactPhone as string,
      vendorId: row.order.vendorId as string,
    },
  };
}

export function createDeliveryRepository(context: RepositoryContext): DeliveryRepository {
  return new DrizzleDeliveryRepository(context);
}
