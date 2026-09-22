import { and, eq, isNull } from 'drizzle-orm';
import {
  driverVehicles,
  drivers,
  stores,
  vendors,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { ConflictError, ValidationError } from '@/lib/errors';

export interface VendorApplicationInput {
  businessName: string;
  legalName?: string;
  gstin?: string;
  fssaiLicense?: string;
  contactPhone: string;
  storeName: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
}

export interface DriverApplicationInput {
  fullName: string;
  phone: string;
  emergencyContact?: string;
  vehicleType: 'BIKE' | 'SCOOTER' | 'BICYCLE' | 'CAR' | 'OTHER';
  registrationNumber?: string;
  makeModel?: string;
}

function cleanRequired(value: string, field: string, min = 2, max = 160): string {
  const cleaned = value.trim();
  if (cleaned.length < min || cleaned.length > max) {
    throw new ValidationError(`${field} is invalid.`);
  }
  return cleaned;
}

function cleanOptional(value: string | undefined, max = 160): string | null {
  const cleaned = value?.trim();
  if (!cleaned) return null;
  if (cleaned.length > max) throw new ValidationError('A field is too long.');
  return cleaned;
}

function cleanPhone(value: string): string {
  const cleaned = value.trim();
  if (!/^\+?[0-9]{10,15}$/.test(cleaned)) {
    throw new ValidationError('Enter a valid phone number.');
  }
  return cleaned.startsWith('+') ? cleaned : `+91${cleaned}`;
}

function cleanPincode(value: string): string {
  const cleaned = value.trim();
  if (!/^[1-9][0-9]{5}$/.test(cleaned)) throw new ValidationError('Enter a valid 6-digit pincode.');
  return cleaned;
}

function slugPart(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug || 'partner';
}

export async function getOwnVendorApplication(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: vendors.id,
      businessName: vendors.businessName,
      status: vendors.status,
      rejectionReason: vendors.rejectionReason,
      suspensionReason: vendors.suspensionReason,
      createdAt: vendors.createdAt,
    })
    .from(vendors)
    .where(and(eq(vendors.ownerUserId, userId), isNull(vendors.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getOwnDriverApplication(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select({
      id: drivers.id,
      fullName: drivers.fullName,
      driverCode: drivers.driverCode,
      status: drivers.status,
      rejectionReason: drivers.rejectionReason,
      createdAt: drivers.createdAt,
    })
    .from(drivers)
    .where(and(eq(drivers.userId, userId), isNull(drivers.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function submitVendorApplication(userId: string, input: VendorApplicationInput) {
  const db = await getDb();

  const existing = await getOwnVendorApplication(userId);
  if (existing) throw new ConflictError('A vendor application already exists for this account.');

  const businessName = cleanRequired(input.businessName, 'Business name');
  const storeName = cleanRequired(input.storeName, 'Store name');
  const contactPhone = cleanPhone(input.contactPhone);
  const pincode = cleanPincode(input.pincode);
  const suffix = userId.replaceAll('-', '').slice(-10).toLowerCase();
  const vendorSlug = `${slugPart(businessName)}-${suffix}`;
  const storeSlug = `${slugPart(storeName)}-${suffix}`;

  return db.transaction(async (tx) => {
    const [vendor] = await tx
      .insert(vendors)
      .values({
        ownerUserId: userId,
        businessName,
        legalName: cleanOptional(input.legalName),
        slug: vendorSlug,
        status: 'APPLIED',
        gstin: cleanOptional(input.gstin, 32),
        fssaiLicense: cleanOptional(input.fssaiLicense, 64),
        contactPhone,
      })
      .returning({ id: vendors.id, status: vendors.status });

    if (!vendor) throw new ConflictError('Vendor application could not be created.');

    await tx.insert(stores).values({
      vendorId: vendor.id,
      name: storeName,
      slug: storeSlug,
      status: 'CLOSED',
      line1: cleanRequired(input.line1, 'Address', 3, 250),
      city: cleanRequired(input.city, 'City', 2, 100),
      state: cleanRequired(input.state, 'State', 2, 100),
      pincode,
      codEnabled: true,
      minOrderPaise: 0,
      isAcceptingOrders: false,
    });

    return vendor;
  });
}

export async function submitDriverApplication(userId: string, input: DriverApplicationInput) {
  const db = await getDb();

  const existing = await getOwnDriverApplication(userId);
  if (existing) throw new ConflictError('A driver application already exists for this account.');

  const phone = cleanPhone(input.phone);
  const fullName = cleanRequired(input.fullName, 'Full name');
  const suffix = userId.replaceAll('-', '').slice(-10).toUpperCase();
  const driverCode = `DRV-${suffix}`;

  return db.transaction(async (tx) => {
    const [driver] = await tx
      .insert(drivers)
      .values({
        userId,
        driverCode,
        status: 'APPLIED',
        availability: 'OFFLINE',
        fullName,
        phone,
        emergencyContact: cleanOptional(input.emergencyContact, 32),
      })
      .returning({ id: drivers.id, status: drivers.status });

    if (!driver) throw new ConflictError('Driver application could not be created.');

    await tx.insert(driverVehicles).values({
      driverId: driver.id,
      vehicleType: input.vehicleType,
      registrationNumber: cleanOptional(input.registrationNumber, 40),
      makeModel: cleanOptional(input.makeModel, 100),
      isActive: true,
    });

    return driver;
  });
}
