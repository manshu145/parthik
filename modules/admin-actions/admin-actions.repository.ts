import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  auditLogs,
  deliveries,
  deliveryAssignments,
  deliveryStatusHistory,
  drivers,
  inventory,
  inventoryTransactions,
  orders,
  payoutBatches,
  products,
  stores,
  supportTickets,
  ticketMessages,
  roles,
  userRoles,
  users,
  vendors,
} from '@/db/schema';
import { getDb, type Database } from '@/lib/db/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

type VendorAction = 'approve' | 'reject' | 'suspend' | 'reactivate';
type DriverAction = 'approve' | 'reject' | 'suspend' | 'reactivate';
type ProductAction = 'approve' | 'reject' | 'deactivate' | 'reactivate';
type CustomerAction = 'suspend' | 'ban' | 'activate';
type PayoutAction = 'approve' | 'mark_paid' | 'fail';

function requiredReason(reason?: string | null) {
  const value = reason?.trim();
  if (!value) {
    throw new ValidationError('A reason is required for this action.', {
      reason: ['Enter a reason before continuing.'],
    });
  }
  return value;
}

export async function updateVendorStatus(
  vendorId: string,
  action: VendorAction,
  actorUserId: string,
  reason?: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: vendors.id, status: vendors.status, ownerUserId: vendors.ownerUserId })
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
      .limit(1);
    if (!before) throw new NotFoundError('Vendor could not be found.');

    const now = new Date();
    let afterStatus: typeof before.status;
    if (action === 'approve') {
      afterStatus = 'APPROVED';
      await tx
        .update(vendors)
        .set({
          status: 'APPROVED',
          approvedAt: now,
          approvedBy: actorUserId,
          rejectionReason: null,
          suspendedAt: null,
          suspensionReason: null,
          updatedAt: now,
        })
        .where(eq(vendors.id, vendorId));

      await ensureRoleGrant(tx, {
        userId: before.ownerUserId,
        roleKey: 'VENDOR_OWNER',
        scopeType: 'VENDOR',
        scopeId: vendorId,
        grantedBy: actorUserId,
      });
    } else if (action === 'reject') {
      const actionReason = requiredReason(reason);
      afterStatus = 'REJECTED';
      await tx
        .update(vendors)
        .set({
          status: 'REJECTED',
          rejectionReason: actionReason,
          approvedAt: null,
          approvedBy: null,
          updatedAt: now,
        })
        .where(eq(vendors.id, vendorId));

      await revokeRoleGrant(tx, before.ownerUserId, 'VENDOR_OWNER', vendorId);

      await tx
        .update(stores)
        .set({
          status: 'OFFLINE_BY_ADMIN',
          isAcceptingOrders: false,
          closedUntil: null,
          updatedAt: now,
        })
        .where(and(eq(stores.vendorId, vendorId), isNull(stores.deletedAt)));
    } else if (action === 'suspend') {
      const actionReason = requiredReason(reason);
      afterStatus = 'SUSPENDED';
      await tx
        .update(vendors)
        .set({
          status: 'SUSPENDED',
          suspendedAt: now,
          suspensionReason: actionReason,
          updatedAt: now,
        })
        .where(eq(vendors.id, vendorId));

      await revokeRoleGrant(tx, before.ownerUserId, 'VENDOR_OWNER', vendorId);

      await tx
        .update(stores)
        .set({
          status: 'OFFLINE_BY_ADMIN',
          isAcceptingOrders: false,
          closedUntil: null,
          updatedAt: now,
        })
        .where(and(eq(stores.vendorId, vendorId), isNull(stores.deletedAt)));
    } else {
      afterStatus = 'APPROVED';
      await tx
        .update(vendors)
        .set({
          status: 'APPROVED',
          suspendedAt: null,
          suspensionReason: null,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(eq(vendors.id, vendorId));

      await ensureRoleGrant(tx, {
        userId: before.ownerUserId,
        roleKey: 'VENDOR_OWNER',
        scopeType: 'VENDOR',
        scopeId: vendorId,
        grantedBy: actorUserId,
      });

      await tx
        .update(stores)
        .set({
          status: 'CLOSED',
          isAcceptingOrders: false,
          closedUntil: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(stores.vendorId, vendorId),
            eq(stores.status, 'OFFLINE_BY_ADMIN'),
            isNull(stores.deletedAt)
          )
        );
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      action: action === 'approve' ? 'APPROVE' : action === 'reject' ? 'REJECT' : 'STATUS_CHANGE',
      entityType: 'vendor',
      entityId: vendorId,
      before: { status: before.status },
      after: { status: afterStatus },
      changedFields: ['status'],
      reason: reason?.trim() || null,
    });

    return { id: vendorId, status: afterStatus };
  });
}

export async function updateDriverStatus(
  driverId: string,
  action: DriverAction,
  actorUserId: string,
  reason?: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: drivers.id, status: drivers.status, userId: drivers.userId })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), isNull(drivers.deletedAt)))
      .limit(1);
    if (!before) throw new NotFoundError('Driver could not be found.');

    const now = new Date();
    let afterStatus: typeof before.status;
    if (action === 'approve') {
      afterStatus = 'APPROVED';
      await tx
        .update(drivers)
        .set({
          status: 'APPROVED',
          approvedAt: now,
          approvedBy: actorUserId,
          rejectionReason: null,
          suspendedAt: null,
          updatedAt: now,
        })
        .where(eq(drivers.id, driverId));

      await ensureRoleGrant(tx, {
        userId: before.userId,
        roleKey: 'DRIVER',
        scopeType: 'GLOBAL',
        scopeId: null,
        grantedBy: actorUserId,
      });
    } else if (action === 'reject') {
      const actionReason = requiredReason(reason);
      afterStatus = 'REJECTED';
      await tx
        .update(drivers)
        .set({
          status: 'REJECTED',
          rejectionReason: actionReason,
          approvedAt: null,
          approvedBy: null,
          updatedAt: now,
        })
        .where(eq(drivers.id, driverId));

      await revokeRoleGrant(tx, before.userId, 'DRIVER', null);
    } else if (action === 'suspend') {
      requiredReason(reason);
      afterStatus = 'SUSPENDED';
      await tx
        .update(drivers)
        .set({
          status: 'SUSPENDED',
          availability: 'OFFLINE',
          suspendedAt: now,
          currentLatitude: null,
          currentLongitude: null,
          locationUpdatedAt: null,
          updatedAt: now,
        })
        .where(eq(drivers.id, driverId));

      await revokeRoleGrant(tx, before.userId, 'DRIVER', null);
    } else {
      afterStatus = 'APPROVED';
      await tx
        .update(drivers)
        .set({
          status: 'APPROVED',
          suspendedAt: null,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(eq(drivers.id, driverId));

      await ensureRoleGrant(tx, {
        userId: before.userId,
        roleKey: 'DRIVER',
        scopeType: 'GLOBAL',
        scopeId: null,
        grantedBy: actorUserId,
      });
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      action: action === 'approve' ? 'APPROVE' : action === 'reject' ? 'REJECT' : 'STATUS_CHANGE',
      entityType: 'driver',
      entityId: driverId,
      before: { status: before.status },
      after: { status: afterStatus },
      changedFields: ['status'],
      reason: reason?.trim() || null,
    });

    return { id: driverId, status: afterStatus };
  });
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function ensureRoleGrant(
  tx: Transaction,
  input: {
    userId: string;
    roleKey: 'VENDOR_OWNER' | 'DRIVER';
    scopeType: 'GLOBAL' | 'VENDOR';
    scopeId: string | null;
    grantedBy: string;
  }
) {
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, input.roleKey))
    .limit(1);
  if (!role) throw new ConflictError(`Role "${input.roleKey}" is not configured.`);

  await tx.insert(userRoles).values({
    userId: input.userId,
    roleId: role.id,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    grantedBy: input.grantedBy,
  }).onConflictDoNothing({
    target: [userRoles.userId, userRoles.roleId, userRoles.scopeId],
    where: sql`revoked_at is null`,
  });
}

async function revokeRoleGrant(
  tx: Transaction,
  userId: string,
  roleKey: 'VENDOR_OWNER' | 'DRIVER',
  scopeId: string | null
) {
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, roleKey))
    .limit(1);
  if (!role) return;

  const scopePredicate = scopeId === null ? isNull(userRoles.scopeId) : eq(userRoles.scopeId, scopeId);
  await tx
    .update(userRoles)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.roleId, role.id),
        scopePredicate,
        isNull(userRoles.revokedAt)
      )
    );
}

export async function updateProductStatus(
  productId: string,
  action: ProductAction,
  actorUserId: string,
  reason?: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: products.id, status: products.status, version: products.version })
      .from(products)
      .where(and(eq(products.id, productId), isNull(products.deletedAt)))
      .limit(1);
    if (!before) throw new NotFoundError('Product could not be found.');

    const now = new Date();
    let afterStatus: typeof before.status;
    if (action === 'approve') {
      afterStatus = 'ACTIVE';
      await tx
        .update(products)
        .set({
          status: 'ACTIVE',
          publishedAt: now,
          updatedBy: actorUserId,
          updatedAt: now,
          version: before.version + 1,
        })
        .where(eq(products.id, productId));
    } else if (action === 'reject') {
      requiredReason(reason);
      afterStatus = 'REJECTED';
      await tx
        .update(products)
        .set({
          status: 'REJECTED',
          updatedBy: actorUserId,
          updatedAt: now,
          version: before.version + 1,
        })
        .where(eq(products.id, productId));
    } else if (action === 'deactivate') {
      afterStatus = 'INACTIVE';
      await tx
        .update(products)
        .set({
          status: 'INACTIVE',
          updatedBy: actorUserId,
          updatedAt: now,
          version: before.version + 1,
        })
        .where(eq(products.id, productId));
    } else {
      afterStatus = 'ACTIVE';
      await tx
        .update(products)
        .set({
          status: 'ACTIVE',
          publishedAt: now,
          updatedBy: actorUserId,
          updatedAt: now,
          version: before.version + 1,
        })
        .where(eq(products.id, productId));
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      action: action === 'approve' ? 'APPROVE' : action === 'reject' ? 'REJECT' : 'STATUS_CHANGE',
      entityType: 'product',
      entityId: productId,
      before: { status: before.status, version: before.version },
      after: { status: afterStatus, version: before.version + 1 },
      changedFields: ['status', 'version'],
      reason: reason?.trim() || null,
    });

    return { id: productId, status: afterStatus };
  });
}

export async function updateCustomerStatus(
  userId: string,
  action: CustomerAction,
  actorUserId: string,
  reason?: string
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!before) throw new NotFoundError('Customer could not be found.');

    if (action !== 'activate') requiredReason(reason);
    const status = action === 'activate' ? 'ACTIVE' : action === 'ban' ? 'BANNED' : 'SUSPENDED';
    await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));

    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'customer',
      entityId: userId,
      before: { status: before.status },
      after: { status },
      changedFields: ['status'],
      reason: reason?.trim() || null,
    });

    return { id: userId, status };
  });
}

export async function adjustInventory(
  inventoryId: string,
  delta: number,
  actorUserId: string,
  reason: string
) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new ValidationError('Inventory adjustment must be a non-zero whole number.', {
      delta: ['Use a non-zero whole number.'],
    });
  }
  const actionReason = requiredReason(reason);
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: inventory.id,
        variantId: inventory.variantId,
        storeId: inventory.storeId,
        quantityAvailable: inventory.quantityAvailable,
        version: inventory.version,
      })
      .from(inventory)
      .where(eq(inventory.id, inventoryId))
      .limit(1);
    if (!before) throw new NotFoundError('Inventory row could not be found.');

    const quantityAfter = before.quantityAvailable + delta;
    if (quantityAfter < 0) {
      throw new ConflictError('Stock cannot be adjusted below zero.');
    }

    await tx
      .update(inventory)
      .set({
        quantityAvailable: quantityAfter,
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(inventory.id, inventoryId));

    await tx.insert(inventoryTransactions).values({
      variantId: before.variantId,
      storeId: before.storeId,
      txnType: 'ADJUSTMENT',
      quantityDelta: delta,
      quantityAfter,
      referenceType: 'MANUAL',
      reason: actionReason,
      createdBy: actorUserId,
    });

    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'UPDATE',
      entityType: 'inventory',
      entityId: inventoryId,
      before: { quantityAvailable: before.quantityAvailable, version: before.version },
      after: { quantityAvailable: quantityAfter, version: before.version + 1 },
      changedFields: ['quantityAvailable', 'version'],
      reason: actionReason,
    });

    return { id: inventoryId, quantityAvailable: quantityAfter };
  });
}

export async function assignDelivery(
  deliveryId: string,
  driverId: string,
  actorUserId: string,
  reason?: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({
        id: deliveries.id,
        orderId: deliveries.orderId,
        status: deliveries.status,
        driverId: deliveries.driverId,
      })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);
    if (!delivery) throw new NotFoundError('Delivery could not be found.');

    if (['DELIVERED', 'FAILED', 'CANCELLED', 'RETURNED_TO_STORE'].includes(delivery.status)) {
      throw new ConflictError(
        'A terminal delivery cannot be reassigned.',
        'INVALID_STATUS_TRANSITION'
      );
    }

    const [driver] = await tx
      .select({ id: drivers.id, status: drivers.status })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), isNull(drivers.deletedAt)))
      .limit(1);
    if (!driver) throw new NotFoundError('Driver could not be found.');
    if (driver.status !== 'APPROVED') {
      throw new ConflictError('Only an approved driver can be assigned.');
    }

    const [latestAttempt] = await tx
      .select({ attemptNumber: deliveryAssignments.attemptNumber })
      .from(deliveryAssignments)
      .where(eq(deliveryAssignments.deliveryId, deliveryId))
      .orderBy(desc(deliveryAssignments.attemptNumber))
      .limit(1);
    const attemptNumber = (latestAttempt?.attemptNumber ?? 0) + 1;
    const now = new Date();

    await tx
      .update(deliveries)
      .set({
        driverId,
        status: 'ASSIGNED',
        assignedAt: now,
        updatedAt: now,
      })
      .where(eq(deliveries.id, deliveryId));

    await tx
      .update(orders)
      .set({ status: 'ASSIGNED', updatedAt: now })
      .where(eq(orders.id, delivery.orderId));

    await tx.insert(deliveryAssignments).values({
      deliveryId,
      driverId,
      offeredAt: now,
      respondedAt: now,
      response: 'ACCEPTED',
      assignedBy: actorUserId,
      attemptNumber,
      dispatchMode: 'MANUAL',
    });

    if (delivery.status !== 'ASSIGNED' || delivery.driverId !== driverId) {
      await tx.insert(deliveryStatusHistory).values({
        deliveryId,
        fromStatus: delivery.status,
        toStatus: 'ASSIGNED',
        changedByUserId: actorUserId,
        changedByRole: 'ADMIN',
        reason: reason?.trim() || 'Manual admin assignment',
      });
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'ASSIGN',
      entityType: 'delivery',
      entityId: deliveryId,
      before: { driverId: delivery.driverId, status: delivery.status },
      after: { driverId, status: 'ASSIGNED' },
      changedFields: ['driverId', 'status'],
      reason: reason?.trim() || null,
    });

    return { id: deliveryId, driverId, status: 'ASSIGNED' as const };
  });
}

export async function replyToSupportTicket(
  ticketId: string,
  actorUserId: string,
  message: string,
  isInternalNote = false
) {
  const text = message.trim();
  if (!text) {
    throw new ValidationError('Reply cannot be empty.', { message: ['Enter a reply.'] });
  }

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select({
        id: supportTickets.id,
        status: supportTickets.status,
        firstResponseAt: supportTickets.firstResponseAt,
      })
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1);
    if (!ticket) throw new NotFoundError('Support ticket could not be found.');
    if (ticket.status === 'CLOSED') {
      throw new ConflictError('Closed tickets cannot receive new replies.');
    }

    const now = new Date();
    const [created] = await tx
      .insert(ticketMessages)
      .values({
        ticketId,
        authorUserId: actorUserId,
        authorRole: 'ADMIN',
        message: text,
        isInternalNote,
      })
      .returning({ id: ticketMessages.id });

    await tx
      .update(supportTickets)
      .set({
        status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
        firstResponseAt: ticket.firstResponseAt ?? now,
        updatedAt: now,
      })
      .where(eq(supportTickets.id, ticketId));

    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'UPDATE',
      entityType: 'support_ticket',
      entityId: ticketId,
      before: { status: ticket.status },
      after: {
        status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status,
        messageAdded: true,
        internal: isInternalNote,
      },
      changedFields: ['messages', 'status'],
    });

    return { id: created?.id ?? null, ticketId };
  });
}

export async function updateSupportTicket(
  ticketId: string,
  actorUserId: string,
  input: {
    status?: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    assignedToUserId?: string | null;
    resolutionNote?: string | null;
  }
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: supportTickets.id,
        status: supportTickets.status,
        priority: supportTickets.priority,
        assignedToUserId: supportTickets.assignedToUserId,
        resolutionNote: supportTickets.resolutionNote,
        resolvedAt: supportTickets.resolvedAt,
        closedAt: supportTickets.closedAt,
      })
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .limit(1);
    if (!before) throw new NotFoundError('Support ticket could not be found.');

    const now = new Date();
    const nextStatus = input.status ?? before.status;
    const nextPriority = input.priority ?? before.priority;
    const nextAssignee =
      input.assignedToUserId === undefined ? before.assignedToUserId : input.assignedToUserId;
    const nextResolution =
      input.resolutionNote === undefined
        ? before.resolutionNote
        : input.resolutionNote?.trim() || null;

    await tx
      .update(supportTickets)
      .set({
        status: nextStatus,
        priority: nextPriority,
        assignedToUserId: nextAssignee,
        resolutionNote: nextResolution,
        resolvedAt: nextStatus === 'RESOLVED' ? (before.resolvedAt ?? now) : before.resolvedAt,
        closedAt: nextStatus === 'CLOSED' ? (before.closedAt ?? now) : before.closedAt,
        updatedAt: now,
      })
      .where(eq(supportTickets.id, ticketId));

    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'support_ticket',
      entityId: ticketId,
      before: {
        status: before.status,
        priority: before.priority,
        assignedToUserId: before.assignedToUserId,
      },
      after: {
        status: nextStatus,
        priority: nextPriority,
        assignedToUserId: nextAssignee,
      },
      changedFields: ['status', 'priority', 'assignedToUserId', 'resolutionNote'],
      reason: nextResolution,
    });

    return { id: ticketId, status: nextStatus, priority: nextPriority };
  });
}

export async function updatePayoutStatus(
  payoutId: string,
  action: PayoutAction,
  actorUserId: string,
  input: { referenceNumber?: string; notes?: string }
) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: payoutBatches.id,
        status: payoutBatches.status,
        referenceNumber: payoutBatches.referenceNumber,
      })
      .from(payoutBatches)
      .where(eq(payoutBatches.id, payoutId))
      .limit(1);
    if (!before) throw new NotFoundError('Payout batch could not be found.');

    const now = new Date();
    if (action === 'approve') {
      if (before.status !== 'DRAFT') {
        throw new ConflictError('Only draft payout batches can be approved.');
      }
      await tx
        .update(payoutBatches)
        .set({
          status: 'APPROVED',
          approvedBy: actorUserId,
          approvedAt: now,
          notes: input.notes?.trim() || null,
          updatedAt: now,
        })
        .where(eq(payoutBatches.id, payoutId));
    } else if (action === 'mark_paid') {
      if (before.status !== 'APPROVED') {
        throw new ConflictError('Only approved payout batches can be marked paid.');
      }
      const referenceNumber = input.referenceNumber?.trim();
      if (!referenceNumber) {
        throw new ValidationError('A settlement reference is required.', {
          referenceNumber: ['Enter the bank/UPI settlement reference.'],
        });
      }
      await tx
        .update(payoutBatches)
        .set({
          status: 'PAID',
          referenceNumber,
          paidAt: now,
          notes: input.notes?.trim() || null,
          updatedAt: now,
        })
        .where(eq(payoutBatches.id, payoutId));
    } else {
      const notes = requiredReason(input.notes);
      await tx
        .update(payoutBatches)
        .set({ status: 'FAILED', notes, updatedAt: now })
        .where(eq(payoutBatches.id, payoutId));
    }

    const status = action === 'approve' ? 'APPROVED' : action === 'mark_paid' ? 'PAID' : 'FAILED';
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'payout_batch',
      entityId: payoutId,
      before: { status: before.status, referenceNumber: before.referenceNumber },
      after: { status, referenceNumber: input.referenceNumber?.trim() || before.referenceNumber },
      changedFields: ['status', 'referenceNumber', 'notes'],
      reason: input.notes?.trim() || null,
    });

    return { id: payoutId, status };
  });
}
