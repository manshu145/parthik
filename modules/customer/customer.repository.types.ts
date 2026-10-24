/**
 * Customer repository contract — addresses.
 *
 * Every method takes a `userId` and the repository puts it IN THE QUERY. That is not
 * belt-and-braces: it means a service that forgets an ownership check still cannot
 * return or mutate another customer's address, because the SQL never selects one
 * (docs/ARCHITECTURE.md §5.1, docs/SECURITY.md §5.4).
 */

export type AddressType = 'HOME' | 'WORK' | 'OTHER';

export interface AddressRecord {
  id: string;
  userId: string;
  label: string | null;
  addressType: AddressType;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  /** Resolved when the address is saved, then RE-VERIFIED at checkout (master spec §11). */
  deliveryZoneId: string | null;
  isDefault: boolean;
  deliveryInstructions: string | null;
}

export interface AddressInput {
  label?: string | null;
  addressType: AddressType;
  recipientName: string;
  recipientPhone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude?: number | null;
  longitude?: number | null;
  deliveryInstructions?: string | null;
  isDefault?: boolean;
}

export interface AddressRepository {
  /** The customer's addresses, default first. Excludes soft-deleted rows. */
  listForUser(userId: string): Promise<AddressRecord[]>;

  /**
   * One address, scoped to its owner.
   *
   * Returns null for "not yours" as well as "does not exist". The caller cannot tell
   * the two apart, which is deliberate: distinguishing them would confirm that an id
   * belongs to somebody (docs/SECURITY.md §5.4).
   */
  findForUser(userId: string, addressId: string): Promise<AddressRecord | null>;

  countForUser(userId: string): Promise<number>;

  /**
   * Creates an address, resolving its zone from the pincode.
   *
   * When `isDefault` is set, any existing default is cleared in the SAME transaction —
   * the database enforces one default per user with a partial unique index, so doing it
   * in two statements would either fail or briefly leave none.
   */
  create(
    userId: string,
    input: AddressInput,
    deliveryZoneId: string | null
  ): Promise<AddressRecord>;

  update(
    userId: string,
    addressId: string,
    input: AddressInput,
    deliveryZoneId: string | null
  ): Promise<AddressRecord | null>;

  /** Soft delete, so historical orders that reference it stay readable. */
  softDelete(userId: string, addressId: string): Promise<boolean>;

  setDefault(userId: string, addressId: string): Promise<boolean>;
}
