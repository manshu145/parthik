import {
  adjustVendorInventory as writeVendorInventory,
  listVendorInventory as readVendorInventory,
} from './vendor-inventory.repository';

export async function listVendorInventory(vendorId: string, limit?: number) {
  return readVendorInventory(vendorId, limit);
}

export async function adjustVendorInventory(
  vendorId: string,
  inventoryId: string,
  actorUserId: string,
  delta: number,
  reason: string
) {
  return writeVendorInventory(vendorId, inventoryId, actorUserId, delta, reason);
}
