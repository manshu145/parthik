import { and, desc, eq } from 'drizzle-orm';
import {
  customerNotificationPreferences,
  notifications,
  productTranslations,
  products,
  supportTickets,
  users,
  wishlistItems,
  wishlists,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';

export async function updateCustomerProfile(
  userId: string,
  input: { fullName: string; preferredLocale: 'en' | 'hi' }
) {
  const db = await getDb();
  await db
    .update(users)
    .set({
      fullName: input.fullName,
      preferredLocale: input.preferredLocale,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function listCustomerNotifications(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      status: notifications.status,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
}

export async function readNotificationPreferences(userId: string) {
  const db = await getDb();
  return db
    .select()
    .from(customerNotificationPreferences)
    .where(eq(customerNotificationPreferences.userId, userId));
}

export async function savePromotionPreference(userId: string, enabled: boolean) {
  const db = await getDb();
  for (const channel of ['PUSH', 'IN_APP'] as const) {
    await db
      .insert(customerNotificationPreferences)
      .values({ userId, channel, category: 'PROMOTION', enabled })
      .onConflictDoUpdate({
        target: [
          customerNotificationPreferences.userId,
          customerNotificationPreferences.channel,
          customerNotificationPreferences.category,
        ],
        set: { enabled, updatedAt: new Date() },
      });
  }
}

export async function createSupportTicket(
  userId: string,
  input: {
    category:
      'PAYMENT' | 'DELIVERY' | 'PRODUCT' | 'REFUND' | 'COUPON' | 'ACCOUNT' | 'VENDOR' | 'OTHER';
    subject: string;
  }
) {
  const db = await getDb();
  const ticketNumber = `PTK-${Date.now().toString(36).toUpperCase()}`;
  await db
    .insert(supportTickets)
    .values({ userId, ticketNumber, category: input.category, subject: input.subject });
}

async function ensureDefaultWishlist(userId: string) {
  const db = await getDb();
  const [existing] = await db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(and(eq(wishlists.userId, userId), eq(wishlists.isDefault, true)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(wishlists)
    .values({ userId, name: 'Favorites', isDefault: true })
    .returning({ id: wishlists.id });
  return created!.id;
}

export async function listFavorites(userId: string) {
  const db = await getDb();
  return db
    .select({
      id: wishlistItems.id,
      productId: products.id,
      slug: products.slug,
      name: productTranslations.name,
      pricePaise: products.pricePaise,
      mrpPaise: products.mrpPaise,
      unitLabel: products.unitLabel,
    })
    .from(wishlistItems)
    .innerJoin(wishlists, eq(wishlistItems.wishlistId, wishlists.id))
    .innerJoin(products, eq(wishlistItems.productId, products.id))
    .innerJoin(
      productTranslations,
      and(eq(productTranslations.productId, products.id), eq(productTranslations.locale, 'en'))
    )
    .where(and(eq(wishlists.userId, userId), eq(wishlists.isDefault, true)))
    .orderBy(desc(wishlistItems.createdAt));
}

export async function addFavorite(userId: string, productId: string) {
  const db = await getDb();
  const wishlistId = await ensureDefaultWishlist(userId);
  await db.insert(wishlistItems).values({ wishlistId, productId }).onConflictDoNothing();
}

export async function removeFavorite(userId: string, itemId: string) {
  const db = await getDb();
  await db.delete(wishlistItems).where(
    and(
      eq(wishlistItems.id, itemId),
      eq(
        wishlistItems.wishlistId,
        db
          .select({ id: wishlists.id })
          .from(wishlists)
          .where(and(eq(wishlists.userId, userId), eq(wishlists.isDefault, true)))
      )
    )
  );
}
