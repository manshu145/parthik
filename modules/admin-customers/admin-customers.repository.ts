import { and, desc, eq, isNull } from 'drizzle-orm';
import { addresses, customerProfiles, orders, users } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export async function listAdminCustomers(limit = 250) {
  const db = await getDb();
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      status: users.status,
      preferredLocale: users.preferredLocale,
      totalOrders: customerProfiles.totalOrders,
      lifetimeValuePaise: customerProfiles.lifetimeValuePaise,
      acquisitionSource: customerProfiles.acquisitionSource,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(customerProfiles)
    .innerJoin(users, eq(users.id, customerProfiles.userId))
    .where(isNull(users.deletedAt))
    .orderBy(desc(customerProfiles.lifetimeValuePaise), desc(users.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export async function readAdminCustomerDetail(userId: string) {
  const db = await getDb();

  const [customer] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      status: users.status,
      preferredLocale: users.preferredLocale,
      phoneVerifiedAt: users.phoneVerifiedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      totalOrders: customerProfiles.totalOrders,
      lifetimeValuePaise: customerProfiles.lifetimeValuePaise,
      referralCode: customerProfiles.referralCode,
      acquisitionSource: customerProfiles.acquisitionSource,
    })
    .from(customerProfiles)
    .innerJoin(users, eq(users.id, customerProfiles.userId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!customer) return null;

  const [savedAddresses, recentOrders] = await Promise.all([
    db
      .select({
        id: addresses.id,
        label: addresses.label,
        addressType: addresses.addressType,
        line1: addresses.line1,
        line2: addresses.line2,
        city: addresses.city,
        state: addresses.state,
        pincode: addresses.pincode,
        isDefault: addresses.isDefault,
      })
      .from(addresses)
      .where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt))
      .limit(20),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        totalAmountPaise: orders.totalAmountPaise,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(20),
  ]);

  return { customer, addresses: savedAddresses, recentOrders };
}
