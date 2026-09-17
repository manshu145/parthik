import { and, asc, eq, isNull } from 'drizzle-orm';
import { driverDocuments, drivers } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export interface DriverDocumentStatusView {
  id: string;
  docType: string;
  fileName: string | null;
  kycStatus: string;
  expiresAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

/**
 * Returns only document status metadata safe for the owning driver to see.
 *
 * Deliberately omitted: storage keys and encrypted document numbers. The private R2 object key is
 * an implementation secret, and the encrypted identifier has no reason to cross the repository
 * boundary for a status screen.
 */
export async function readDriverDocumentsForUser(
  userId: string
): Promise<DriverDocumentStatusView[]> {
  const db = await getDb();

  const [driver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(and(eq(drivers.userId, userId), isNull(drivers.deletedAt)))
    .limit(1);

  if (!driver) throw new NotFoundError('No driver profile is linked to this account.');

  return db
    .select({
      id: driverDocuments.id,
      docType: driverDocuments.docType,
      fileName: driverDocuments.fileName,
      kycStatus: driverDocuments.kycStatus,
      expiresAt: driverDocuments.expiresAt,
      reviewedAt: driverDocuments.reviewedAt,
      rejectionReason: driverDocuments.rejectionReason,
    })
    .from(driverDocuments)
    .where(eq(driverDocuments.driverId, driver.id))
    .orderBy(asc(driverDocuments.docType), asc(driverDocuments.createdAt));
}
