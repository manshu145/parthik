import { and, asc, eq, isNull } from 'drizzle-orm';
import { deliveries, deliveryProofs, drivers } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export interface DriverDeliveryProofView {
  delivery: {
    id: string;
    status: (typeof deliveries.$inferSelect)['status'];
    otpVerifiedAt: Date | null;
    otpAttempts: number;
    otpRegeneratedCount: number;
    deliveredAt: Date | null;
    failedAt: Date | null;
    failureReason: string | null;
  };
  proofs: Array<{
    id: string;
    proofType: (typeof deliveryProofs.$inferSelect)['proofType'];
    otpVerified: boolean;
    capturedAt: Date | null;
    createdAt: Date;
  }>;
}

/**
 * Privacy-safe proof projection for one authenticated driver's delivery.
 *
 * Ownership is resolved from the authenticated user and joined to the delivery. The projection
 * deliberately excludes the private R2 storage key, recipient name, notes and coordinates. Those
 * fields are evidence/admin data, not information that needs to remain visible on a driver page.
 */
export async function getDeliveryProofForDriverUser(
  userId: string,
  deliveryId: string
): Promise<DriverDeliveryProofView> {
  const db = await getDb();

  const [delivery] = await db
    .select({
      id: deliveries.id,
      status: deliveries.status,
      otpVerifiedAt: deliveries.otpVerifiedAt,
      otpAttempts: deliveries.otpAttempts,
      otpRegeneratedCount: deliveries.otpRegeneratedCount,
      deliveredAt: deliveries.deliveredAt,
      failedAt: deliveries.failedAt,
      failureReason: deliveries.failureReason,
    })
    .from(deliveries)
    .innerJoin(
      drivers,
      and(
        eq(drivers.id, deliveries.driverId),
        eq(drivers.userId, userId),
        isNull(drivers.deletedAt)
      )
    )
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!delivery) throw new NotFoundError('That delivery could not be found.');

  const proofs = await db
    .select({
      id: deliveryProofs.id,
      proofType: deliveryProofs.proofType,
      otpVerified: deliveryProofs.otpVerified,
      capturedAt: deliveryProofs.capturedAt,
      createdAt: deliveryProofs.createdAt,
    })
    .from(deliveryProofs)
    .where(eq(deliveryProofs.deliveryId, delivery.id))
    .orderBy(asc(deliveryProofs.createdAt), asc(deliveryProofs.id));

  return { delivery, proofs };
}
