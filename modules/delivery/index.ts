import { getDb, isDatabaseConfigured } from '@/lib/db/client';
import { ConfigurationError } from '@/lib/errors';
import { getCashService } from '@/modules/cash';
import { StableHistoryDeliveryRepository } from './delivery-history.repository';
import { DeliveryService } from './delivery.service';

/**
 * Delivery module composition root.
 *
 * NO IN-MEMORY BACKEND. A delivery carries an OTP, someone's address and, for COD, a claim on
 * physical cash — a version of it that evaporates would lose the evidence that an order was
 * handed over at all.
 *
 * The CASH SERVICE is injected rather than imported inside the service, so the COD eligibility
 * gate and the driver's cash screen share one definition of "cash in hand". Two independent
 * calculations is how a driver ends up excluded from dispatch while being told they are fine.
 */
export async function getDeliveryService(): Promise<DeliveryService> {
  if (!isDatabaseConfigured()) {
    throw new ConfigurationError(
      'Deliveries require a database. Set DATABASE_URL — there is deliberately no in-memory delivery backend.'
    );
  }

  const [db, cash] = await Promise.all([getDb(), getCashService()]);

  return new DeliveryService({
    repository: new StableHistoryDeliveryRepository({ db }),
    cashInHandPaise: (driverId) => cash.cashInHandPaise(driverId),
  });
}

export { DeliveryService, createDeliveryService } from './delivery.service';
export type { DeliveryServiceDeps, OfferView } from './delivery.service';
export { StableHistoryDeliveryRepository } from './delivery-history.repository';
export { DrizzleDeliveryRepository, createDeliveryRepository } from './delivery.repository';
export {
  generateOtp,
  hashOtp,
  isOtpShaped,
  otpHashesMatch,
  MAX_OTP_ATTEMPTS,
  MAX_OTP_REGENERATIONS,
  OTP_LENGTH,
} from './delivery.otp';
export {
  assignDriverBodySchema,
  availabilityBodySchema,
  declineBodySchema,
  deliverBodySchema,
  deliveryIdParamSchema,
  deliveryStepBodySchema,
  failBodySchema,
  locationPingBodySchema,
} from './delivery.schema';
export type {
  DeliveryRecord,
  DeliveryRepository,
  DeliveryStatus,
  DeliveryWithOrder,
  DriverAvailability,
  DriverRecord,
} from './delivery.repository.types';
