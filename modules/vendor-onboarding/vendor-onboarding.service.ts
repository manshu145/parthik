import { readVendorOnboarding } from './vendor-onboarding.repository';

/**
 * Application-facing vendor onboarding service.
 *
 * The caller passes only a vendor id resolved from the authenticated actor's scoped grant; all
 * data access remains behind the repository chokepoint.
 */
export async function getVendorOnboarding(vendorId: string) {
  return readVendorOnboarding(vendorId);
}
