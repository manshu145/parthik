import type { OrderStatus } from '@/modules/order';

/**
 * Delivery repository contract.
 *
 * Shaped by the one transaction that matters: **completing a delivery.** Marking the delivery
 * delivered, moving the order, converting the stock reservation to a sale, marking the COD
 * payment paid and writing the driver's cash ledger entry are ONE operation
 * (docs/API_SPEC.md §6.1). Exposing them separately would let a caller commit a delivery whose
 * cash was never recorded — which is money missing from a driver's float with nothing to
 * reconcile against.
 */

export type DeliveryStatus =
  | 'PENDING_ASSIGNMENT'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'EN_ROUTE_TO_STORE'
  | 'AT_STORE'
  | 'PICKED_UP'
  | 'EN_ROUTE_TO_CUSTOMER'
  | 'AT_CUSTOMER'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RETURNED_TO_STORE';

export type DriverAvailability = 'OFFLINE' | 'ONLINE' | 'ON_DELIVERY' | 'ON_BREAK';

export interface DriverRecord {
  id: string;
  userId: string;
  driverCode: string;
  status: string;
  availability: DriverAvailability;
  fullName: string;
  phone: string;
  currentLatitude: string | null;
  currentLongitude: string | null;
}

export interface DeliveryRecord {
  id: string;
  orderId: string;
  storeId: string;
  driverId: string | null;
  status: DeliveryStatus;
  deliveryZoneId: string | null;
  pickupAddressSnapshot: Record<string, unknown>;
  dropAddressSnapshot: Record<string, unknown>;
  deliveryFeePaise: number;
  otpVerifiedAt: Date | null;
  otpAttempts: number;
  otpRegeneratedCount: number;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  codExpectedPaise: number | null;
  codCollectedPaise: number | null;
  codVariancePaise: number | null;
  createdAt: Date;
}

/** A delivery plus the order facts a driver or a screen needs. */
export interface DeliveryWithOrder {
  delivery: DeliveryRecord;
  order: {
    id: string;
    orderNumber: string;
    userId: string;
    status: OrderStatus;
    isCod: boolean;
    codAmountPaise: number | null;
    totalAmountPaise: number;
    contactName: string;
    contactPhone: string;
    vendorId: string;
  };
}

export interface CreateDeliveryInput {
  orderId: string;
  storeId: string;
  deliveryZoneId: string | null;
  pickupAddressSnapshot: Record<string, unknown>;
  dropAddressSnapshot: Record<string, unknown>;
  deliveryFeePaise: number;
  /** Snapshot of what the driver must collect. Null for a prepaid order. */
  codExpectedPaise: number | null;
  /** Already hashed. The plaintext never reaches this layer. */
  otpHash: string;
}

export type DeliveryTransitionOutcome = 'MOVED' | 'ALREADY_THERE' | 'STALE';

export interface CompleteDeliveryInput {
  deliveryId: string;
  driverId: string;
  /** SHA-256 of the submitted code, salted with the delivery id. */
  submittedOtpHash: string;
  codCollectedPaise: number | null;
  recipientName: string | null;
  proofStorageKey: string | null;
  actorUserId: string;
}

/**
 * The outcome of completing a delivery.
 *
 * `OTP_INVALID` carries the remaining attempts so the driver's screen can say "2 tries left"
 * rather than just refusing — and `OTP_LOCKED` is separate because it needs a different remedy
 * (the customer asks for a new code) rather than another guess.
 */
export type CompleteDeliveryResult =
  | {
      ok: true;
      /** Positive when the driver collected LESS than expected. Never silently accepted. */
      codVariancePaise: number;
      codCollectedPaise: number | null;
    }
  | { ok: false; reason: 'OTP_INVALID'; attemptsRemaining: number }
  | { ok: false; reason: 'OTP_LOCKED' }
  | { ok: false; reason: 'ALREADY_DELIVERED' }
  | { ok: false; reason: 'WRONG_STATUS'; status: DeliveryStatus };

/** The pickup end of a delivery, frozen onto the row at dispatch. */
export interface StoreForDelivery {
  id: string;
  name: string;
  /** Nullable in the schema: a store can be onboarded before its address is complete. */
  line1: string | null;
  city: string | null;
  pincode: string | null;
  latitude: string | null;
  longitude: string | null;
}

export interface DeliveryRepository {
  /** Read here rather than through the catalogue service: dispatch needs an address, not a store. */
  findStoreForDelivery(storeId: string): Promise<StoreForDelivery | null>;
  findDriverByUserId(userId: string): Promise<DriverRecord | null>;
  findDriverById(driverId: string): Promise<DriverRecord | null>;
  setAvailability(driverId: string, availability: DriverAvailability): Promise<void>;
  /** Overwrites the ephemeral dispatch position (D-29, C-1). */
  updateDriverLocation(
    driverId: string,
    position: { latitude: number; longitude: number }
  ): Promise<void>;

  /**
   * Creates the delivery for an order, or returns the existing one.
   *
   * `deliveries_order_key` is unique on `order_id`, so dispatch running twice — a retried queue
   * message, a vendor double-clicking "ready" — cannot produce two deliveries for one order.
   */
  createForOrder(
    input: CreateDeliveryInput
  ): Promise<{ delivery: DeliveryRecord; created: boolean }>;

  findById(deliveryId: string): Promise<DeliveryWithOrder | null>;
  findByOrderId(orderId: string): Promise<DeliveryWithOrder | null>;
  /** The driver's current job. At most one is in flight at a time. */
  findActiveForDriver(driverId: string): Promise<DeliveryWithOrder | null>;
  listForDriver(
    driverId: string,
    page: { limit: number; cursor?: string | undefined }
  ): Promise<{ items: DeliveryWithOrder[]; nextCursor: string | null }>;

  /** Deliveries waiting for a driver, for the offer queue. */
  listAwaitingAssignment(limit: number): Promise<DeliveryWithOrder[]>;

  /**
   * Assigns a driver, atomically.
   *
   * Returns false when somebody else won the race. The alternative — read, decide, write —
   * hands the same delivery to two drivers, and both turn up at the store.
   */
  claim(input: {
    deliveryId: string;
    driverId: string;
    actorUserId: string | null;
  }): Promise<boolean>;

  /** Records a driver declining an offer, so dispatch does not re-offer it to them. */
  recordDecline(input: {
    deliveryId: string;
    driverId: string;
    reason: string | null;
  }): Promise<void>;

  /** Moves the delivery within its own state machine, recording history. */
  advance(input: {
    deliveryId: string;
    driverId: string;
    from: DeliveryStatus[];
    to: DeliveryStatus;
    actorUserId: string;
    position?: { latitude: number; longitude: number } | undefined;
    reason?: string | null;
  }): Promise<DeliveryTransitionOutcome>;

  /** Verifies the OTP and completes everything in ONE transaction. */
  complete(input: CompleteDeliveryInput): Promise<CompleteDeliveryResult>;

  fail(input: {
    deliveryId: string;
    driverId: string;
    reason: string;
    actorUserId: string;
  }): Promise<DeliveryTransitionOutcome>;

  /** Stores a fresh OTP hash and counts the regeneration. */
  regenerateOtp(input: {
    deliveryId: string;
    otpHash: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'TOO_MANY' | 'NOT_FOUND' | 'ALREADY_DELIVERED' }>;
}
