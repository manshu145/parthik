import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { mockMapsProvider } from '@/lib/maps/mock-provider';
import { CustomerService, MAX_ADDRESSES_PER_USER } from '@/modules/customer/customer.service';
import {
  InMemoryCustomerRepository,
  resetInMemoryAddressesForTests,
} from '@/modules/customer/customer-memory.repository';
import { addressBodySchema } from '@/modules/customer/customer.schema';
import { LocationService } from '@/modules/location/location.service';
import { InMemoryLocationRepository } from '@/modules/location/location-memory.repository';

/**
 * Address book tests.
 *
 * Two things carry real consequences and get the attention:
 *
 *   THE DEFAULT INVARIANT  The database enforces at most one default per user with a
 *                          partial unique index, so a service that promotes without
 *                          demoting does not misbehave — it throws. And a customer with NO
 *                          default opens checkout with nothing selected, which reads as
 *                          broken.
 *   OWNERSHIP              A missing address and somebody else's address must be
 *                          indistinguishable (docs/SECURITY.md §5.4).
 */

const USER = 'user-address-1';
const OTHER = 'user-address-2';

const ADDRESS = {
  addressType: 'HOME' as const,
  recipientName: 'Address Tester',
  recipientPhone: '+919876543210',
  line1: '1 Test Street',
  city: 'Indore',
  state: 'Madhya Pradesh',
  pincode: '452001',
};

function service() {
  const location = new LocationService({
    repository: new InMemoryLocationRepository(),
    maps: mockMapsProvider,
  });

  return new CustomerService({
    repository: new InMemoryCustomerRepository({ isolated: true }),
    location,
  });
}

function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : 'NOT_AN_APP_ERROR';
}

beforeEach(() => resetInMemoryAddressesForTests());
afterEach(() => resetInMemoryAddressesForTests());

describe('the default address invariant', () => {
  it('makes the first address the default automatically', async () => {
    const customer = service();
    const created = await customer.createAddress(USER, ADDRESS);

    // A customer with exactly one address and no default is a state the checkout picker
    // would have to special-case for no reason.
    expect(created.isDefault).toBe(true);
  });

  it('does not let a later address steal the default', async () => {
    const customer = service();
    await customer.createAddress(USER, ADDRESS);
    const second = await customer.createAddress(USER, { ...ADDRESS, label: 'Work' });

    expect(second.isDefault).toBe(false);
  });

  it('honours an explicit isDefault on create', async () => {
    const customer = service();
    await customer.createAddress(USER, ADDRESS);
    const second = await customer.createAddress(USER, { ...ADDRESS, isDefault: true });

    expect(second.isDefault).toBe(true);
    const list = await customer.listAddresses(USER);
    expect(list.filter((address) => address.isDefault)).toHaveLength(1);
  });

  it('keeps exactly one default through repeated promotion', async () => {
    const customer = service();
    const a = await customer.createAddress(USER, { ...ADDRESS, label: 'A' });
    const b = await customer.createAddress(USER, { ...ADDRESS, label: 'B' });
    const c = await customer.createAddress(USER, { ...ADDRESS, label: 'C' });

    for (const id of [b.id, c.id, a.id, c.id]) {
      await customer.setDefaultAddress(USER, id);
      const defaults = (await customer.listAddresses(USER)).filter((row) => row.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.id).toBe(id);
    }
  });

  it('promotes a replacement when the default is deleted', async () => {
    const customer = service();
    const first = await customer.createAddress(USER, { ...ADDRESS, label: 'A' });
    await customer.createAddress(USER, { ...ADDRESS, label: 'B' });

    await customer.deleteAddress(USER, first.id);

    const list = await customer.listAddresses(USER);
    expect(list).toHaveLength(1);
    // Otherwise checkout opens with nothing selected and looks broken.
    expect(list[0]!.isDefault).toBe(true);
  });

  it('leaves no default when the last address is deleted', async () => {
    const customer = service();
    const only = await customer.createAddress(USER, ADDRESS);

    await customer.deleteAddress(USER, only.id);

    expect(await customer.listAddresses(USER)).toEqual([]);
  });

  it('does not demote on a plain update', async () => {
    const customer = service();
    const created = await customer.createAddress(USER, ADDRESS);

    const updated = await customer.updateAddress(USER, created.id, {
      ...ADDRESS,
      line1: '2 Changed Street',
    });

    // isDefault is absent from the body, which must mean "leave it alone" rather than
    // "set it to false" — the latter would leave the customer with no default.
    expect(updated.isDefault).toBe(true);
  });

  it('sorts the default first', async () => {
    const customer = service();
    await customer.createAddress(USER, { ...ADDRESS, label: 'A' });
    const b = await customer.createAddress(USER, { ...ADDRESS, label: 'B' });
    await customer.setDefaultAddress(USER, b.id);

    const list = await customer.listAddresses(USER);
    expect(list[0]!.id).toBe(b.id);
  });
});

describe('ownership', () => {
  it('does not list another customer\u2019s addresses', async () => {
    const customer = service();
    await customer.createAddress(USER, ADDRESS);

    expect(await customer.listAddresses(OTHER)).toEqual([]);
  });

  it.each([
    ['read', (c: CustomerService, id: string) => c.getAddress(OTHER, id)],
    ['update', (c: CustomerService, id: string) => c.updateAddress(OTHER, id, ADDRESS)],
    ['delete', (c: CustomerService, id: string) => c.deleteAddress(OTHER, id)],
    ['promote', (c: CustomerService, id: string) => c.setDefaultAddress(OTHER, id)],
  ])('refuses to %s an address owned by somebody else', async (_label, act) => {
    const customer = service();
    const mine = await customer.createAddress(USER, ADDRESS);

    // NOT_FOUND rather than FORBIDDEN: a 403 would confirm the id belongs to someone.
    await expect(act(customer, mine.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a nonexistent address identically to somebody else\u2019s', async () => {
    const customer = service();
    const mine = await customer.createAddress(USER, ADDRESS);

    const missing = await customer.getAddress(USER, mine.id).then(
      () => null,
      (error: unknown) => codeOf(error)
    );
    const notMine = await customer.getAddress(OTHER, mine.id).then(
      () => null,
      (error: unknown) => codeOf(error)
    );
    const absent = await customer.getAddress(USER, 'no-such-address').then(
      () => null,
      (error: unknown) => codeOf(error)
    );

    expect(missing).toBeNull(); // the owner can read it
    expect(notMine).toBe('NOT_FOUND');
    expect(absent).toBe('NOT_FOUND');
  });
});

describe('serviceability annotation', () => {
  it('marks a serviceable pincode', async () => {
    const customer = service();
    await customer.createAddress(USER, ADDRESS);

    const [address] = await customer.listAddresses(USER);
    expect(address!.isServiceable).toBe(true);
    expect(address!.zoneName).toBeTruthy();
  });

  it('saves an unserviceable address but marks it so', async () => {
    const customer = service();
    // Refusing to store it would lose information the customer will want when we do
    // deliver there. Checkout is where serviceability is enforced.
    await customer.createAddress(USER, { ...ADDRESS, pincode: '110001' });

    const [address] = await customer.listAddresses(USER);
    expect(address).toBeDefined();
    expect(address!.isServiceable).toBe(false);
  });

  it('resolves serviceability on READ, not from the stored zone', async () => {
    const customer = service();
    const created = await customer.createAddress(USER, { ...ADDRESS, pincode: '110001' });

    // The stored zone is null because the pincode was unserviceable at save time; the
    // annotation is computed fresh, which is what lets a newly-serviced pincode light up
    // without a data migration.
    expect(created.deliveryZoneId).toBeNull();
    const [address] = await customer.listAddresses(USER);
    expect(address!.isServiceable).toBe(false);
  });
});

describe('limits', () => {
  it(`refuses more than ${MAX_ADDRESSES_PER_USER} addresses`, async () => {
    const customer = service();

    for (let index = 0; index < MAX_ADDRESSES_PER_USER; index += 1) {
      await customer.createAddress(USER, { ...ADDRESS, label: `A${index}` });
    }

    await expect(customer.createAddress(USER, ADDRESS)).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATED',
    });
  });
});

describe('input validation', () => {
  it('normalises a bare 10-digit mobile to E.164', () => {
    const parsed = addressBodySchema.parse({ ...ADDRESS, recipientPhone: '9876543210' });
    expect(parsed.recipientPhone).toBe('+919876543210');
  });

  it.each(['1234567890', '+911234567890', '98765', 'abcdefghij', ''])(
    'rejects the invalid phone %s',
    (phone) => {
      expect(addressBodySchema.safeParse({ ...ADDRESS, recipientPhone: phone }).success).toBe(
        false
      );
    }
  );

  it.each(['012345', '12345', '1234567', 'abcdef', ''])(
    'rejects the invalid pincode %s',
    (pincode) => {
      // Indian PIN codes never start with zero.
      expect(addressBodySchema.safeParse({ ...ADDRESS, pincode }).success).toBe(false);
    }
  );

  it('does NOT accept a client-supplied delivery zone', () => {
    const parsed = addressBodySchema.parse({
      ...ADDRESS,
      deliveryZoneId: 'a-zone-the-client-picked',
    } as Record<string, unknown>);

    // The zone sets the delivery fee and COD eligibility, so it is resolved server-side
    // from the pincode and a supplied one is stripped rather than honoured.
    expect(parsed).not.toHaveProperty('deliveryZoneId');
  });

  it('rejects coordinates outside India', () => {
    expect(
      addressBodySchema.safeParse({ ...ADDRESS, latitude: 51.5, longitude: -0.12 }).success
    ).toBe(false);
  });

  it('accepts coordinates inside India', () => {
    expect(
      addressBodySchema.safeParse({ ...ADDRESS, latitude: 22.7196, longitude: 75.8577 }).success
    ).toBe(true);
  });

  it('defaults the address type to HOME', () => {
    const { addressType: _omitted, ...withoutType } = ADDRESS;
    expect(addressBodySchema.parse(withoutType).addressType).toBe('HOME');
  });
});
