import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { vendorDocuments, vendors } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export interface VendorOnboardingDocumentView {
  id: string;
  docType: string;
  fileName: string | null;
  kycStatus: string;
  expiresAt: Date | null;
  isExpired: boolean;
  rejectionReason: string | null;
}

export interface VendorOnboardingView {
  vendor: {
    id: string;
    businessName: string;
    legalName: string | null;
    status: string;
    rejectionReason: string | null;
    suspensionReason: string | null;
  };
  documents: VendorOnboardingDocumentView[];
}

/**
 * Privacy-safe vendor onboarding projection.
 *
 * `vendorId` must come from the authenticated actor's scoped grant. This repository deliberately
 * omits document storage keys and does not expose bank-account or store-management data; D-32 is
 * still open and the onboarding screen does not need those details to explain KYC progress.
 */
export async function readVendorOnboarding(vendorId: string): Promise<VendorOnboardingView> {
  const db = await getDb();

  const [vendor] = await db
    .select({
      id: vendors.id,
      businessName: vendors.businessName,
      legalName: vendors.legalName,
      status: vendors.status,
      rejectionReason: vendors.rejectionReason,
      suspensionReason: vendors.suspensionReason,
    })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
    .limit(1);

  if (!vendor) throw new NotFoundError('Vendor profile could not be found.');

  const documents = await db
    .select({
      id: vendorDocuments.id,
      docType: vendorDocuments.docType,
      fileName: vendorDocuments.fileName,
      kycStatus: vendorDocuments.kycStatus,
      expiresAt: vendorDocuments.expiresAt,
      isExpired: sql<boolean>`${vendorDocuments.expiresAt} is not null and ${vendorDocuments.expiresAt} <= now()`,
      rejectionReason: vendorDocuments.rejectionReason,
    })
    .from(vendorDocuments)
    .where(eq(vendorDocuments.vendorId, vendorId))
    .orderBy(asc(vendorDocuments.docType), asc(vendorDocuments.createdAt));

  return { vendor, documents };
}
