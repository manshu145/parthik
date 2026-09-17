import { listVendorInventory as readVendorInventory } from './vendor-inventory.repository';

export async function listVendorInventory(vendorId: string, limit?: number) {
  return readVendorInventory(vendorId, limit);
}
