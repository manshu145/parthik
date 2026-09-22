import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { driverDocuments, drivers, stores, vendorDocuments, vendors } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export interface AdminVendorListItem {
  id: string;
  businessName: string;
  legalName: string | null;
  status: string;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: Date;
}

export interface AdminDriverListItem {
  id: string;
  driverCode: string;
  fullName: string;
  phone: string;
  status: string;
  availability: string;
  totalDeliveries: number;
  successfulDeliveries: number;
  ratingAvg: string | null;
  createdAt: Date;
}

export async function listAdminVendors(limit = 100): Promise<AdminVendorListItem[]> {
  const db = await getDb();
  return db
    .select({
      id: vendors.id,
      businessName: vendors.businessName,
      legalName: vendors.legalName,
      status: vendors.status,
      contactPhone: vendors.contactPhone,
      contactEmail: vendors.contactEmail,
      createdAt: vendors.createdAt,
    })
    .from(vendors)
    .where(isNull(vendors.deletedAt))
    .orderBy(desc(vendors.createdAt), desc(vendors.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function listAdminDrivers(limit = 100): Promise<AdminDriverListItem[]> {
  const db = await getDb();
  return db
    .select({
      id: drivers.id,
      driverCode: drivers.driverCode,
      fullName: drivers.fullName,
      phone: drivers.phone,
      status: drivers.status,
      availability: drivers.availability,
      totalDeliveries: drivers.totalDeliveries,
      successfulDeliveries: drivers.successfulDeliveries,
      ratingAvg: drivers.ratingAvg,
      createdAt: drivers.createdAt,
    })
    .from(drivers)
    .where(isNull(drivers.deletedAt))
    .orderBy(desc(drivers.createdAt), desc(drivers.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function readAdminVendorDetail(vendorId: string) {
  const db = await getDb();
  const [vendor] = await db
    .select({
      id: vendors.id,
      businessName: vendors.businessName,
      legalName: vendors.legalName,
      slug: vendors.slug,
      status: vendors.status,
      gstin: vendors.gstin,
      fssaiLicense: vendors.fssaiLicense,
      contactPhone: vendors.contactPhone,
      contactEmail: vendors.contactEmail,
      approvedAt: vendors.approvedAt,
      rejectionReason: vendors.rejectionReason,
      suspendedAt: vendors.suspendedAt,
      suspensionReason: vendors.suspensionReason,
      createdAt: vendors.createdAt,
    })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
    .limit(1);

  if (!vendor) throw new NotFoundError('Vendor could not be found.');

  const [documents, vendorStores] = await Promise.all([
    db
      .select({
        id: vendorDocuments.id,
        docType: vendorDocuments.docType,
        fileName: vendorDocuments.fileName,
        kycStatus: vendorDocuments.kycStatus,
        expiresAt: vendorDocuments.expiresAt,
        rejectionReason: vendorDocuments.rejectionReason,
      })
      .from(vendorDocuments)
      .where(eq(vendorDocuments.vendorId, vendorId))
      .orderBy(asc(vendorDocuments.docType)),
    db
      .select({
        id: stores.id,
        name: stores.name,
        status: stores.status,
        city: stores.city,
        pincode: stores.pincode,
        isAcceptingOrders: stores.isAcceptingOrders,
      })
      .from(stores)
      .where(and(eq(stores.vendorId, vendorId), isNull(stores.deletedAt)))
      .orderBy(asc(stores.name)),
  ]);

  return { vendor, documents, stores: vendorStores };
}

export async function readAdminDriverDetail(driverId: string) {
  const db = await getDb();
  const [driver] = await db
    .select({
      id: drivers.id,
      driverCode: drivers.driverCode,
      fullName: drivers.fullName,
      phone: drivers.phone,
      status: drivers.status,
      availability: drivers.availability,
      dateOfBirth: drivers.dateOfBirth,
      emergencyContact: drivers.emergencyContact,
      ratingAvg: drivers.ratingAvg,
      ratingCount: drivers.ratingCount,
      totalDeliveries: drivers.totalDeliveries,
      successfulDeliveries: drivers.successfulDeliveries,
      approvedAt: drivers.approvedAt,
      rejectionReason: drivers.rejectionReason,
      suspendedAt: drivers.suspendedAt,
      createdAt: drivers.createdAt,
    })
    .from(drivers)
    .where(and(eq(drivers.id, driverId), isNull(drivers.deletedAt)))
    .limit(1);

  if (!driver) throw new NotFoundError('Driver could not be found.');

  const documents = await db
    .select({
      id: driverDocuments.id,
      docType: driverDocuments.docType,
      fileName: driverDocuments.fileName,
      kycStatus: driverDocuments.kycStatus,
      expiresAt: driverDocuments.expiresAt,
      rejectionReason: driverDocuments.rejectionReason,
    })
    .from(driverDocuments)
    .where(eq(driverDocuments.driverId, driverId))
    .orderBy(asc(driverDocuments.docType));

  return { driver, documents };
}
