import { listVendorProducts as readVendorProducts } from './vendor-products.repository';

export async function listVendorProducts(vendorId: string, limit?: number) {
  return readVendorProducts(vendorId, limit);
}
