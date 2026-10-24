import { getDeliveryProofForDriverUser as readDeliveryProofForDriverUser } from './delivery-proof.repository';

/** Application-facing boundary for the driver's proof/status screen. */
export async function getDeliveryProofForDriverUser(userId: string, deliveryId: string) {
  return readDeliveryProofForDriverUser(userId, deliveryId);
}
