import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import type { LocationService } from '@/modules/location/location.service';
import type { AddressInput, AddressRecord, AddressRepository } from './customer.repository.types';

/**
 * Address book service.
 *
 * Two rules live here rather than in a route handler:
 *
 *   ZONE RESOLUTION  The delivery zone is derived from the pincode SERVER-SIDE, never
 *                    accepted from the client. The zone sets the delivery fee and COD
 *                    eligibility, so a client-chosen zone would be a pricing control.
 *   OWNERSHIP        Every read and write is scoped to the signed-in user, and a
 *                    missing-or-not-yours address is reported identically.
 */

/**
 * Ceiling on saved addresses.
 *
 * Not a technical limit — it stops the picker becoming unusable and blunts a trivial
 * way to write unbounded rows against one account.
 */
export const MAX_ADDRESSES_PER_USER = 20;

export interface CustomerServiceDeps {
  repository: AddressRepository;
  location: LocationService;
}

/** An address with its serviceability resolved at read time. */
export interface AddressWithServiceability extends AddressRecord {
  isServiceable: boolean;
  zoneName: string | null;
  etaMinutes: number | null;
}

export class CustomerService {
  constructor(private readonly deps: CustomerServiceDeps) {}

  /**
   * Lists addresses, each annotated with whether we can currently deliver there.
   *
   * Resolved on READ, not from the stored `delivery_zone_id`. Zones change: a pincode
   * that was serviceable when the address was saved may not be today, and showing a
   * stale "we deliver here" is how a customer reaches payment before being told no.
   */
  async listAddresses(userId: string): Promise<AddressWithServiceability[]> {
    const records = await this.deps.repository.listForUser(userId);

    // Distinct pincodes only: several addresses commonly share one, and serviceability
    // is a cached lookup we should not repeat per row.
    const pincodes = [...new Set(records.map((record) => record.pincode))];
    const results = await Promise.all(
      pincodes.map(
        async (pincode) => [pincode, await this.deps.location.checkServiceability(pincode)] as const
      )
    );
    const byPincode = new Map(results);

    return records.map((record) => {
      const serviceability = byPincode.get(record.pincode);

      return {
        ...record,
        isServiceable: serviceability?.isServiceable ?? false,
        zoneName: serviceability?.zone?.name ?? null,
        etaMinutes: serviceability?.etaMinutes ?? null,
      };
    });
  }

  async getAddress(userId: string, addressId: string): Promise<AddressRecord> {
    const address = await this.deps.repository.findForUser(userId, addressId);
    if (!address) throw new NotFoundError('That address could not be found.');
    return address;
  }

  async createAddress(userId: string, input: AddressInput): Promise<AddressRecord> {
    const count = await this.deps.repository.countForUser(userId);

    if (count >= MAX_ADDRESSES_PER_USER) {
      throw new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        `You can save at most ${MAX_ADDRESSES_PER_USER} addresses. Please remove one first.`
      );
    }

    return this.deps.repository.create(userId, input, await this.resolveZoneId(input.pincode));
  }

  async updateAddress(
    userId: string,
    addressId: string,
    input: AddressInput
  ): Promise<AddressRecord> {
    const updated = await this.deps.repository.update(
      userId,
      addressId,
      input,
      await this.resolveZoneId(input.pincode)
    );

    if (!updated) throw new NotFoundError('That address could not be found.');
    return updated;
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const deleted = await this.deps.repository.softDelete(userId, addressId);
    if (!deleted) throw new NotFoundError('That address could not be found.');
  }

  async setDefaultAddress(userId: string, addressId: string): Promise<void> {
    const updated = await this.deps.repository.setDefault(userId, addressId);
    if (!updated) throw new NotFoundError('That address could not be found.');
  }

  /**
   * Resolves the zone for a pincode, or null.
   *
   * An UNSERVICEABLE pincode is still saved. The customer chose it, and refusing to
   * store an address because we do not deliver there yet loses information they will
   * want when we do — checkout is where serviceability is enforced.
   */
  private async resolveZoneId(pincode: string): Promise<string | null> {
    const serviceability = await this.deps.location.checkServiceability(pincode);
    return serviceability.zone?.id ?? null;
  }
}

export function createCustomerService(deps: CustomerServiceDeps): CustomerService {
  return new CustomerService(deps);
}
