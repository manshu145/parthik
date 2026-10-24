import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { addresses } from '@/db/schema';
import type { Database } from '@/lib/db/client';
import type { RepositoryContext } from '@/lib/db/repository';
import { ConflictError } from '@/lib/errors';
import type {
  AddressInput,
  AddressRecord,
  AddressRepository,
  AddressType,
} from './customer.repository.types';

/**
 * Drizzle address repository.
 *
 * `user_id` appears in the WHERE clause of every statement, including the writes. A
 * service that forgot an ownership check would still be unable to touch another
 * customer's row, because no statement here can address one.
 */
export class DrizzleCustomerRepository implements AddressRepository {
  private readonly db: Database;

  constructor(context: RepositoryContext) {
    this.db = context.db;
  }

  async listForUser(userId: string): Promise<AddressRecord[]> {
    const rows = await this.db
      .select(addressColumns)
      .from(addresses)
      .where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)))
      // Default first, then newest: the checkout picker should open on the address the
      // customer most likely wants.
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt), asc(addresses.id));

    return rows.map(mapAddress);
  }

  async findForUser(userId: string, addressId: string): Promise<AddressRecord | null> {
    const [row] = await this.db
      .select(addressColumns)
      .from(addresses)
      .where(
        and(
          eq(addresses.id, addressId),
          // Ownership is part of the lookup, not a check afterwards.
          eq(addresses.userId, userId),
          isNull(addresses.deletedAt)
        )
      )
      .limit(1);

    return row ? mapAddress(row) : null;
  }

  async countForUser(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: addresses.id })
      .from(addresses)
      .where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)));

    return rows.length;
  }

  async create(
    userId: string,
    input: AddressInput,
    deliveryZoneId: string | null
  ): Promise<AddressRecord> {
    return this.db.transaction(async (tx) => {
      // The FIRST address is always the default, whatever the caller asked for. A
      // customer with exactly one address and no default is a state the checkout picker
      // would have to special-case for no reason.
      const existing = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)));

      const shouldBeDefault = existing.length === 0 || input.isDefault === true;

      if (shouldBeDefault) await clearDefault(tx, userId);

      const [row] = await tx
        .insert(addresses)
        .values({
          userId,
          label: input.label ?? null,
          addressType: input.addressType,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          latitude: input.latitude != null ? String(input.latitude) : null,
          longitude: input.longitude != null ? String(input.longitude) : null,
          deliveryZoneId,
          isDefault: shouldBeDefault,
          deliveryInstructions: input.deliveryInstructions ?? null,
        })
        .returning(addressColumns);

      if (!row) throw new ConflictError('Could not save the address.');
      return mapAddress(row);
    });
  }

  async update(
    userId: string,
    addressId: string,
    input: AddressInput,
    deliveryZoneId: string | null
  ): Promise<AddressRecord | null> {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: addresses.id, isDefault: addresses.isDefault })
        .from(addresses)
        .where(
          and(
            eq(addresses.id, addressId),
            eq(addresses.userId, userId),
            isNull(addresses.deletedAt)
          )
        )
        .limit(1);

      if (!owned) return null;

      // Promoting this address demotes the current default in the same transaction, so
      // the partial unique index is never violated. Demoting is not offered: leaving a
      // customer with no default is a worse state than having one they must change.
      const shouldBeDefault = input.isDefault === true || owned.isDefault;
      if (input.isDefault === true && !owned.isDefault) await clearDefault(tx, userId);

      const [row] = await tx
        .update(addresses)
        .set({
          label: input.label ?? null,
          addressType: input.addressType,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          line1: input.line1,
          line2: input.line2 ?? null,
          landmark: input.landmark ?? null,
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          latitude: input.latitude != null ? String(input.latitude) : null,
          longitude: input.longitude != null ? String(input.longitude) : null,
          deliveryZoneId,
          isDefault: shouldBeDefault,
          deliveryInstructions: input.deliveryInstructions ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning(addressColumns);

      return row ? mapAddress(row) : null;
    });
  }

  /**
   * Soft delete.
   *
   * Never a hard delete: `orders.delivery_address_snapshot` keeps a frozen copy so an
   * order stays readable, but support still needs to trace which address row an old
   * order came from.
   */
  async softDelete(userId: string, addressId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(addresses)
        .set({ deletedAt: new Date(), isDefault: false })
        .where(
          and(
            eq(addresses.id, addressId),
            eq(addresses.userId, userId),
            isNull(addresses.deletedAt)
          )
        )
        .returning({ id: addresses.id, wasDefault: addresses.isDefault });

      if (!row) return false;

      // Deleting the default leaves the customer with none, so the next-newest is
      // promoted. Otherwise checkout would open with nothing selected and look broken.
      const [replacement] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt)))
        .orderBy(desc(addresses.createdAt))
        .limit(1);

      if (replacement) {
        await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, replacement.id));
      }

      return true;
    });
  }

  async setDefault(userId: string, addressId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(
          and(
            eq(addresses.id, addressId),
            eq(addresses.userId, userId),
            isNull(addresses.deletedAt)
          )
        )
        .limit(1);

      if (!owned) return false;

      await clearDefault(tx, userId);

      await tx
        .update(addresses)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));

      return true;
    });
  }
}

/**
 * Clears the user's current default.
 *
 * Always called inside the same transaction as the promotion, because the partial
 * unique index `addresses_default_key` permits exactly one default per user — two
 * separate statements would fail on the way through.
 */
async function clearDefault(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  userId: string
): Promise<void> {
  await tx
    .update(addresses)
    .set({ isDefault: false })
    .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
}

const addressColumns = {
  id: addresses.id,
  userId: addresses.userId,
  label: addresses.label,
  addressType: addresses.addressType,
  recipientName: addresses.recipientName,
  recipientPhone: addresses.recipientPhone,
  line1: addresses.line1,
  line2: addresses.line2,
  landmark: addresses.landmark,
  city: addresses.city,
  state: addresses.state,
  pincode: addresses.pincode,
  country: addresses.country,
  latitude: addresses.latitude,
  longitude: addresses.longitude,
  deliveryZoneId: addresses.deliveryZoneId,
  isDefault: addresses.isDefault,
  deliveryInstructions: addresses.deliveryInstructions,
} as const;

interface AddressRow {
  id: string;
  userId: string;
  label: string | null;
  addressType: string;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  // `numeric` arrives as a string; parsed once here so no call site has to remember.
  latitude: string | null;
  longitude: string | null;
  deliveryZoneId: string | null;
  isDefault: boolean;
  deliveryInstructions: string | null;
}

function mapAddress(row: AddressRow): AddressRecord {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    addressType: row.addressType as AddressType,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    country: row.country,
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    deliveryZoneId: row.deliveryZoneId,
    isDefault: row.isDefault,
    deliveryInstructions: row.deliveryInstructions,
  };
}

export function createCustomerRepository(context: RepositoryContext): AddressRepository {
  return new DrizzleCustomerRepository(context);
}

/** Kept for the `sql` import used by the partial-index predicates above. */
export const ADDRESS_ACTIVE_PREDICATE = sql`deleted_at is null`;
