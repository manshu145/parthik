import { fixtureId } from '@/lib/db/fixture-id';
import type { AddressInput, AddressRecord, AddressRepository } from './customer.repository.types';

/**
 * In-memory address repository.
 *
 * Exists so the address-book RULES can be tested without a database: first-address-becomes-default,
 * exactly one default at a time, promotion after deleting the default, and the
 * ownership scoping. Those are the parts that go wrong, and they are tedious to set up
 * against live Postgres.
 *
 * Shared on `globalThis` for the same reason as the identity store: Next.js compiles
 * route handlers and server components into separate module graphs, so a module-level
 * singleton exists once PER GRAPH — an address created through a route handler would be
 * invisible to the page that renders next.
 */

interface StoredAddress extends AddressRecord {
  deletedAt: Date | null;
  createdAt: number;
}

interface AddressStore {
  rows: Map<string, StoredAddress>;
  sequence: number;
}

const STORE_KEY = '__parthikAddressStore';

type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: AddressStore };

function sharedStore(): AddressStore {
  const existing = (globalThis as GlobalWithStore)[STORE_KEY];
  if (existing) return existing;

  const created: AddressStore = { rows: new Map(), sequence: 0 };
  (globalThis as GlobalWithStore)[STORE_KEY] = created;
  return created;
}

export function resetInMemoryAddressesForTests(): void {
  delete (globalThis as GlobalWithStore)[STORE_KEY];
}

export class InMemoryCustomerRepository implements AddressRepository {
  private readonly store: AddressStore;

  constructor(options: { isolated?: boolean } = {}) {
    this.store = options.isolated ? { rows: new Map(), sequence: 0 } : sharedStore();
  }

  private active(userId: string): StoredAddress[] {
    return [...this.store.rows.values()]
      .filter((row) => row.userId === userId && row.deletedAt === null)
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }

  async listForUser(userId: string): Promise<AddressRecord[]> {
    return this.active(userId).map(strip);
  }

  async findForUser(userId: string, addressId: string): Promise<AddressRecord | null> {
    const row = this.store.rows.get(addressId);
    // Ownership is part of the lookup, exactly as in SQL.
    if (!row || row.userId !== userId || row.deletedAt !== null) return null;
    return strip(row);
  }

  async countForUser(userId: string): Promise<number> {
    return this.active(userId).length;
  }

  async create(
    userId: string,
    input: AddressInput,
    deliveryZoneId: string | null
  ): Promise<AddressRecord> {
    this.store.sequence += 1;
    const id = fixtureId('address', `${userId}:${this.store.sequence}`);

    const shouldBeDefault = this.active(userId).length === 0 || input.isDefault === true;
    if (shouldBeDefault) this.clearDefault(userId);

    const row: StoredAddress = {
      id,
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
      country: 'IN',
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      deliveryZoneId,
      isDefault: shouldBeDefault,
      deliveryInstructions: input.deliveryInstructions ?? null,
      deletedAt: null,
      createdAt: this.store.sequence,
    };

    this.store.rows.set(id, row);
    return strip(row);
  }

  async update(
    userId: string,
    addressId: string,
    input: AddressInput,
    deliveryZoneId: string | null
  ): Promise<AddressRecord | null> {
    const row = this.store.rows.get(addressId);
    if (!row || row.userId !== userId || row.deletedAt !== null) return null;

    const shouldBeDefault = input.isDefault === true || row.isDefault;
    if (input.isDefault === true && !row.isDefault) this.clearDefault(userId);

    Object.assign(row, {
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
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      deliveryZoneId,
      isDefault: shouldBeDefault,
      deliveryInstructions: input.deliveryInstructions ?? null,
    });

    return strip(row);
  }

  async softDelete(userId: string, addressId: string): Promise<boolean> {
    const row = this.store.rows.get(addressId);
    if (!row || row.userId !== userId || row.deletedAt !== null) return false;

    row.deletedAt = new Date();
    row.isDefault = false;

    // Promote the next-newest, so the customer is never left with no default.
    const replacement = this.active(userId)[0];
    if (replacement) replacement.isDefault = true;

    return true;
  }

  async setDefault(userId: string, addressId: string): Promise<boolean> {
    const row = this.store.rows.get(addressId);
    if (!row || row.userId !== userId || row.deletedAt !== null) return false;

    this.clearDefault(userId);
    row.isDefault = true;
    return true;
  }

  private clearDefault(userId: string): void {
    for (const row of this.store.rows.values()) {
      if (row.userId === userId && row.deletedAt === null) row.isDefault = false;
    }
  }
}

function strip(row: StoredAddress): AddressRecord {
  const { deletedAt: _deletedAt, createdAt: _createdAt, ...record } = row;
  return { ...record };
}
