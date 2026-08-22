import { BusinessRuleError, ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSetting } from '@/modules/settings';
import { generateOtp, hashOtp, isOtpShaped, MAX_OTP_ATTEMPTS } from './delivery.otp';
import type {
  DeliveryRepository,
  DeliveryWithOrder,
  DriverAvailability,
  DriverRecord,
} from './delivery.repository.types';

/**
 * Delivery service (D-18 dispatch, D-20 OTP).
 *
 * Owns three things that must not be anywhere else:
 *
 *   OTP LIFECYCLE   generated here, hashed before it reaches the repository, returned in
 *                   plaintext exactly once and never stored in the clear.
 *   ELIGIBILITY     who may be offered a delivery, including the COD CASH LIMIT — a driver
 *                   already holding more than the configured float is not offered more cash
 *                   work, and is told why rather than just receiving no offers.
 *   OWNERSHIP       a driver may only act on their OWN delivery. The DRIVER role holds no
 *                   permissions at all by design, so every check here is an ownership check.
 */

export interface DeliveryServiceDeps {
  repository: DeliveryRepository;
  /** Cash in hand, for the COD eligibility gate. Injected to keep the modules decoupled. */
  cashInHandPaise: (driverId: string) => Promise<number>;
}

export interface OfferView {
  deliveryId: string;
  orderNumber: string;
  storeName: string;
  dropSummary: string;
  isCod: boolean;
  codExpectedPaise: number | null;
  deliveryFeePaise: number;
  createdAt: Date;
}

export class DeliveryService {
  constructor(private readonly deps: DeliveryServiceDeps) {}

  /**
   * Creates the delivery for an order that is ready (D-18 step 0).
   *
   * Returns the OTP in PLAINTEXT exactly once, to its caller, so it can be delivered to the
   * customer. Nothing stores it: only the hash is persisted, so from this moment on the code
   * exists in the customer's hands and nowhere else. If it is lost, the customer regenerates —
   * which is why `regenerateOtpForCustomer` exists rather than a "resend" that re-reads a stored
   * value it must not have.
   */
  async dispatchForOrder(input: {
    orderId: string;
    storeId: string;
    deliveryZoneId: string | null;
    deliveryFeePaise: number;
    codExpectedPaise: number | null;
    dropAddressSnapshot: Record<string, unknown>;
  }): Promise<{ deliveryId: string; otp: string | null; created: boolean }> {
    const store = await this.deps.repository.findStoreForDelivery(input.storeId);
    if (!store) throw new NotFoundError('That store could not be found.');

    const code = generateOtp();

    /**
     * Hashed against a PLACEHOLDER id first, then rewritten.
     *
     * The hash is salted with the delivery id, which does not exist until the row does. Rather
     * than weaken the salt, the row is created and the OTP is then set through the same
     * regeneration path — one code path for "give this delivery an OTP" instead of two.
     */
    const { delivery, created } = await this.deps.repository.createForOrder({
      orderId: input.orderId,
      storeId: input.storeId,
      deliveryZoneId: input.deliveryZoneId,
      pickupAddressSnapshot: {
        name: store.name,
        line1: store.line1,
        city: store.city,
        pincode: store.pincode,
        latitude: store.latitude,
        longitude: store.longitude,
      },
      dropAddressSnapshot: input.dropAddressSnapshot,
      deliveryFeePaise: input.deliveryFeePaise,
      codExpectedPaise: input.codExpectedPaise,
      // A placeholder that cannot match any 6-digit code, replaced immediately below.
      otpHash: 'pending',
    });

    if (!created) {
      // Dispatch ran twice. The existing delivery keeps its own code — issuing a new one would
      // invalidate the code the customer already has.
      return { deliveryId: delivery.id, otp: null, created: false };
    }

    const result = await this.deps.repository.regenerateOtp({
      deliveryId: delivery.id,
      otpHash: await hashOtp(code, delivery.id),
    });

    if (!result.ok) throw new ConflictError('Could not prepare the delivery code.');

    logger.info('Delivery created', { deliveryId: delivery.id, orderId: input.orderId });
    return { deliveryId: delivery.id, otp: code, created: true };
  }

  /**
   * A fresh code, at the CUSTOMER's request.
   *
   * The only way to see a code after dispatch, because nothing keeps the plaintext. Bounded, and
   * it resets the attempt counter — the driver is about to type a different number, so holding
   * failed guesses of the old one against them would lock a legitimate delivery.
   */
  async regenerateOtpForCustomer(input: {
    orderId: string;
    userId: string;
  }): Promise<{ otp: string }> {
    const found = await this.deps.repository.findByOrderId(input.orderId);
    if (!found) throw new NotFoundError('That delivery could not be found.');

    // Another customer's order and a nonexistent one are the same answer.
    if (found.order.userId !== input.userId) {
      throw new NotFoundError('That delivery could not be found.');
    }

    const code = generateOtp();
    const result = await this.deps.repository.regenerateOtp({
      deliveryId: found.delivery.id,
      otpHash: await hashOtp(code, found.delivery.id),
    });

    if (!result.ok) {
      if (result.reason === 'TOO_MANY') {
        throw new BusinessRuleError(
          'BUSINESS_RULE_VIOLATED',
          'This delivery code has been reissued too many times. Please contact support.'
        );
      }
      throw new ConflictError('This delivery is already complete.');
    }

    return { otp: code };
  }

  /** The caller's own driver record, or a refusal. */
  async requireDriver(userId: string): Promise<DriverRecord> {
    const driver = await this.deps.repository.findDriverByUserId(userId);
    if (!driver) throw new NotFoundError('No driver profile is linked to this account.');
    return driver;
  }

  async setAvailability(input: {
    userId: string;
    availability: DriverAvailability;
  }): Promise<DriverRecord> {
    const driver = await this.requireDriver(input.userId);

    if (input.availability !== 'OFFLINE' && driver.status !== 'APPROVED') {
      /**
       * An unapproved driver cannot go online, and is TOLD why.
       *
       * Silently accepting it and then never sending offers is the version of this that
       * generates support tickets (docs/API_SPEC.md §8).
       */
      throw new BusinessRuleError(
        'BUSINESS_RULE_VIOLATED',
        'Your driver account is not approved yet, so you cannot go online.'
      );
    }

    if (driver.availability === 'ON_DELIVERY' && input.availability === 'OFFLINE') {
      throw new ConflictError('Finish or hand back your current delivery before going offline.');
    }

    await this.deps.repository.setAvailability(driver.id, input.availability);
    return { ...driver, availability: input.availability };
  }

  async updateLocation(input: {
    userId: string;
    latitude: number;
    longitude: number;
  }): Promise<void> {
    const driver = await this.requireDriver(input.userId);

    if (driver.availability === 'OFFLINE') {
      // An offline driver's position is not collected at all (C-1), so a stray ping is refused
      // rather than quietly stored.
      throw new ConflictError('Go online before sharing your location.');
    }

    await this.deps.repository.updateDriverLocation(driver.id, {
      latitude: input.latitude,
      longitude: input.longitude,
    });
  }

  /**
   * The offers this driver may actually take.
   *
   * The cash-limit filter is the important part: a driver already carrying more than
   * `cod.driver_cash_limit_paise` is excluded from COD work (D-18), and `cashBlocked` in the
   * response is what lets the app say "deposit your cash to get more COD orders" instead of
   * showing an empty list for no visible reason.
   */
  async listOffers(input: { userId: string; limit?: number }): Promise<{
    offers: OfferView[];
    cashBlocked: boolean;
    cashInHandPaise: number;
    cashLimitPaise: number;
  }> {
    const driver = await this.requireDriver(input.userId);

    const [limitPaise, inHand, waiting] = await Promise.all([
      getSetting('cod.driver_cash_limit_paise'),
      this.deps.cashInHandPaise(driver.id),
      this.deps.repository.listAwaitingAssignment(input.limit ?? 20),
    ]);

    const cashBlocked = inHand >= limitPaise;

    const offers = waiting
      .filter((candidate) => !(cashBlocked && candidate.order.isCod))
      .map((candidate) => toOffer(candidate));

    return { offers, cashBlocked, cashInHandPaise: inHand, cashLimitPaise: limitPaise };
  }

  /**
   * Accepts an offer. First accept wins.
   *
   * A losing driver gets a CONFLICT rather than a silent no-op, because their screen has to stop
   * showing them a job that is now somebody else's.
   */
  async acceptOffer(input: { userId: string; deliveryId: string }): Promise<DeliveryWithOrder> {
    const driver = await this.requireDriver(input.userId);

    const found = await this.deps.repository.findById(input.deliveryId);
    if (!found) throw new NotFoundError('That delivery could not be found.');

    if (found.order.isCod) {
      const [limitPaise, inHand] = await Promise.all([
        getSetting('cod.driver_cash_limit_paise'),
        this.deps.cashInHandPaise(driver.id),
      ]);

      if (inHand >= limitPaise) {
        throw new BusinessRuleError(
          'DRIVER_CASH_LIMIT_EXCEEDED',
          'You are holding too much cash to take another cash order. Deposit it to continue.'
        );
      }
    }

    const active = await this.deps.repository.findActiveForDriver(driver.id);
    if (active && active.delivery.id !== input.deliveryId) {
      // One job at a time. Two open deliveries is how both arrive late.
      throw new ConflictError('Finish your current delivery first.');
    }

    const claimed = await this.deps.repository.claim({
      deliveryId: input.deliveryId,
      driverId: driver.id,
      actorUserId: input.userId,
    });

    if (!claimed) throw new ConflictError('Another driver has already taken this delivery.');

    const assigned = await this.deps.repository.findById(input.deliveryId);
    if (!assigned) throw new NotFoundError('That delivery could not be found.');

    logger.info('Delivery accepted', { deliveryId: input.deliveryId, driverId: driver.id });
    return assigned;
  }

  async declineOffer(input: {
    userId: string;
    deliveryId: string;
    reason: string | null;
  }): Promise<void> {
    const driver = await this.requireDriver(input.userId);
    await this.deps.repository.recordDecline({
      deliveryId: input.deliveryId,
      driverId: driver.id,
      reason: input.reason,
    });
  }

  async activeForDriver(userId: string): Promise<DeliveryWithOrder | null> {
    const driver = await this.requireDriver(userId);
    return this.deps.repository.findActiveForDriver(driver.id);
  }

  async history(input: { userId: string; limit: number; cursor?: string | undefined }) {
    const driver = await this.requireDriver(input.userId);
    return this.deps.repository.listForDriver(driver.id, {
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
  }

  /** Driver taps "reached the store". */
  async reachedStore(input: { userId: string; deliveryId: string; position?: Position }) {
    return this.step(input, ['ASSIGNED', 'EN_ROUTE_TO_STORE'], 'AT_STORE');
  }

  /** Driver confirms pickup. Moves the ORDER to PICKED_UP in the same transaction. */
  async pickup(input: { userId: string; deliveryId: string; position?: Position }) {
    return this.step(input, ['ASSIGNED', 'EN_ROUTE_TO_STORE', 'AT_STORE'], 'PICKED_UP');
  }

  async reachedCustomer(input: { userId: string; deliveryId: string; position?: Position }) {
    return this.step(input, ['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER'], 'AT_CUSTOMER');
  }

  /** Driver is on the way. Moves the ORDER to OUT_FOR_DELIVERY, which the customer sees. */
  async enRouteToCustomer(input: { userId: string; deliveryId: string; position?: Position }) {
    return this.step(input, ['PICKED_UP'], 'EN_ROUTE_TO_CUSTOMER');
  }

  /**
   * Completes the delivery: OTP, cash and everything downstream.
   *
   * Returns a WARNING rather than an error when the cash collected does not match what was
   * expected. Refusing the delivery over a ten-rupee shortfall would strand the customer and the
   * driver on the doorstep; recording the variance keeps reconciliation honest without doing that
   * (docs/API_SPEC.md §6.1).
   */
  async deliver(input: {
    userId: string;
    deliveryId: string;
    otp: string;
    codCollectedPaise?: number | null;
    recipientName?: string | null;
    proofKey?: string | null;
  }): Promise<{
    codVariancePaise: number;
    codCollectedPaise: number | null;
    warning: 'COD_AMOUNT_MISMATCH' | null;
  }> {
    const driver = await this.requireDriver(input.userId);

    if (!isOtpShaped(input.otp)) {
      // Rejected before any hashing or any attempt is counted: a mistyped 5-digit code is not a
      // guess, and burning one of five attempts on it would be unfair.
      throw new BusinessRuleError('VALIDATION_FAILED', 'Enter the 6-digit delivery code.');
    }

    const found = await this.deps.repository.findById(input.deliveryId);
    if (!found) throw new NotFoundError('That delivery could not be found.');
    if (found.delivery.driverId !== driver.id) {
      throw new NotFoundError('That delivery could not be found.');
    }

    /**
     * A COD delivery MUST report an amount.
     *
     * Defaulting a missing value to the expected amount would record a collection that may never
     * have happened, and the driver would be liable for cash they never took.
     */
    if (
      found.order.isCod &&
      (input.codCollectedPaise === undefined || input.codCollectedPaise === null)
    ) {
      throw new BusinessRuleError(
        'COD_AMOUNT_MISMATCH',
        'Enter the cash you collected before completing this delivery.'
      );
    }

    const result = await this.deps.repository.complete({
      deliveryId: input.deliveryId,
      driverId: driver.id,
      submittedOtpHash: await hashOtp(input.otp, input.deliveryId),
      codCollectedPaise: found.order.isCod ? (input.codCollectedPaise ?? 0) : null,
      recipientName: input.recipientName ?? null,
      proofStorageKey: input.proofKey ?? null,
      actorUserId: input.userId,
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'OTP_INVALID':
          throw new BusinessRuleError(
            'VALIDATION_FAILED',
            `That code is not correct. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`,
            { details: { attemptsRemaining: result.attemptsRemaining } }
          );
        case 'OTP_LOCKED':
          throw new BusinessRuleError(
            'BUSINESS_RULE_VIOLATED',
            `Too many incorrect codes (${MAX_OTP_ATTEMPTS}). Ask the customer to request a new code.`
          );
        case 'ALREADY_DELIVERED':
          // Idempotent from the driver's point of view: the job is done either way.
          return { codVariancePaise: 0, codCollectedPaise: null, warning: null };
        default:
          throw new ConflictError('Confirm pickup before completing this delivery.');
      }
    }

    if (result.codVariancePaise !== 0) {
      logger.warn('COD collection variance recorded', {
        deliveryId: input.deliveryId,
        driverId: driver.id,
        variancePaise: result.codVariancePaise,
      });
    }

    return {
      codVariancePaise: result.codVariancePaise,
      codCollectedPaise: result.codCollectedPaise,
      warning: result.codVariancePaise === 0 ? null : 'COD_AMOUNT_MISMATCH',
    };
  }

  async fail(input: { userId: string; deliveryId: string; reason: string }): Promise<void> {
    const driver = await this.requireDriver(input.userId);

    const outcome = await this.deps.repository.fail({
      deliveryId: input.deliveryId,
      driverId: driver.id,
      reason: input.reason,
      actorUserId: input.userId,
    });

    if (outcome === 'STALE') throw new ConflictError('This delivery is already complete.');
  }

  private async step(
    input: { userId: string; deliveryId: string; position?: Position },
    from: Parameters<DeliveryRepository['advance']>[0]['from'],
    to: Parameters<DeliveryRepository['advance']>[0]['to']
  ): Promise<{ status: typeof to }> {
    const driver = await this.requireDriver(input.userId);

    const outcome = await this.deps.repository.advance({
      deliveryId: input.deliveryId,
      driverId: driver.id,
      from,
      to,
      actorUserId: input.userId,
      ...(input.position ? { position: input.position } : {}),
    });

    if (outcome === 'STALE') {
      throw new ConflictError('This delivery has already moved on. Reload and try again.');
    }

    return { status: to };
  }
}

interface Position {
  latitude: number;
  longitude: number;
}

function toOffer(candidate: DeliveryWithOrder): OfferView {
  const drop = candidate.delivery.dropAddressSnapshot;

  return {
    deliveryId: candidate.delivery.id,
    orderNumber: candidate.order.orderNumber,
    storeName: readString(candidate.delivery.pickupAddressSnapshot, 'name') ?? 'Store',
    /**
     * Area and PIN code only, NOT the full address or the customer's name.
     *
     * An offer is shown to every eligible driver, most of whom will not take it, so it carries
     * the least that still lets a driver judge the trip (master spec §14).
     */
    dropSummary: [readString(drop, 'city'), readString(drop, 'pincode')]
      .filter(Boolean)
      .join(' — '),
    isCod: candidate.order.isCod,
    codExpectedPaise: candidate.delivery.codExpectedPaise,
    deliveryFeePaise: candidate.delivery.deliveryFeePaise,
    createdAt: candidate.delivery.createdAt,
  };
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function createDeliveryService(deps: DeliveryServiceDeps): DeliveryService {
  return new DeliveryService(deps);
}
