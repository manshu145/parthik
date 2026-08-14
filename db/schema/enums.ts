import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * PostgreSQL enum types (docs/DATABASE.md §2).
 *
 * Native enums are used for closed sets that change only by deploy. Sets that
 * admins must extend at runtime are lookup tables instead (for example
 * `supported_locales`, `cancellation_reasons`).
 *
 * Values are transcribed from the approved design. Members marked "reserved" are
 * intentionally present but unused in V1 — removing them later is a breaking
 * migration, whereas leaving them costs nothing.
 */

export const userStatus = pgEnum('user_status', [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'BANNED',
  'DELETED',
]);

/** Reserved: V1 is Firebase phone OTP only (D-09). */
export const authMethod = pgEnum('auth_method', ['PHONE_OTP', 'EMAIL_PASSWORD', 'EMAIL_OTP']);

export const roleKey = pgEnum('role_key', [
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_STAFF',
  'DRIVER',
  'ADMIN',
  'ADMIN_SUPPORT',
  'ADMIN_OPS',
  'ADMIN_FINANCE',
  'SUPER_ADMIN',
]);

export const roleScopeType = pgEnum('role_scope_type', ['GLOBAL', 'VENDOR', 'STORE']);

/**
 * V1 uses ORDER_DELIVERY only — Firebase owns login/signup OTP (D-24). The other
 * members stay for future non-Firebase OTP needs.
 */
export const otpPurpose = pgEnum('otp_purpose', [
  'LOGIN',
  'SIGNUP',
  'PHONE_VERIFY',
  'EMAIL_VERIFY',
  'ORDER_DELIVERY',
  'PASSWORD_RESET',
]);

export const addressType = pgEnum('address_type', ['HOME', 'WORK', 'OTHER']);

export const kycStatus = pgEnum('kyc_status', [
  'NOT_SUBMITTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

export const vendorStatus = pgEnum('vendor_status', [
  'APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);

export const storeStatus = pgEnum('store_status', [
  'OPEN',
  'CLOSED',
  'TEMPORARILY_CLOSED',
  'OFFLINE_BY_ADMIN',
]);

export const productStatus = pgEnum('product_status', [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'INACTIVE',
  'REJECTED',
  'ARCHIVED',
]);

export const inventoryTxnType = pgEnum('inventory_txn_type', [
  'PURCHASE',
  'SALE',
  'RESERVE',
  'RELEASE',
  'ADJUSTMENT',
  'RETURN',
  'DAMAGE',
  'CANCELLATION',
]);

export const inventoryReferenceType = pgEnum('inventory_reference_type', [
  'ORDER',
  'MANUAL',
  'IMPORT',
  'RETURN',
]);

export const orderStatus = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'REFUNDED',
  'RETURNED',
  'FAILED_DELIVERY',
]);

export const orderSource = pgEnum('order_source', ['WEB', 'PWA', 'ADMIN']);

/** D-12: UPI + Card + COD. NETBANKING/WALLET reserved, not offered in V1. */
export const paymentMethod = pgEnum('payment_method', [
  'UPI',
  'CARD',
  'COD',
  'NETBANKING',
  'WALLET',
]);

export const paymentStatus = pgEnum('payment_status', [
  'CREATED',
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
]);

export const refundStatus = pgEnum('refund_status', [
  'INITIATED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export const refundType = pgEnum('refund_type', ['FULL', 'PARTIAL']);

export const couponType = pgEnum('coupon_type', ['FLAT', 'PERCENTAGE', 'FREE_DELIVERY']);

export const promotionType = pgEnum('promotion_type', [
  'BUY_X_GET_Y',
  'CATEGORY_DISCOUNT',
  'VENDOR_CAMPAIGN',
  'FLASH_SALE',
  'FREE_DELIVERY',
  'NEW_CUSTOMER',
]);

export const discountScope = pgEnum('discount_scope', [
  'CART',
  'CATEGORY',
  'PRODUCT',
  'VENDOR',
  'DELIVERY',
]);

export const couponRestrictionType = pgEnum('coupon_restriction_type', [
  'CATEGORY',
  'PRODUCT',
  'VENDOR',
  'ZONE',
  'USER',
]);

export const driverStatus = pgEnum('driver_status', [
  'APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
]);

export const driverAvailability = pgEnum('driver_availability', [
  'OFFLINE',
  'ONLINE',
  'ON_DELIVERY',
  'ON_BREAK',
]);

export const deliveryStatus = pgEnum('delivery_status', [
  'PENDING_ASSIGNMENT',
  'OFFERED',
  'ASSIGNED',
  'EN_ROUTE_TO_STORE',
  'AT_STORE',
  'PICKED_UP',
  'EN_ROUTE_TO_CUSTOMER',
  'AT_CUSTOMER',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
  'RETURNED_TO_STORE',
]);

export const proofType = pgEnum('proof_type', [
  'OTP',
  'PHOTO',
  'SIGNATURE',
  'CUSTOMER_CONFIRMATION',
]);

export const assignmentResponse = pgEnum('assignment_response', [
  'ACCEPTED',
  'DECLINED',
  'TIMEOUT',
  'CANCELLED',
]);

/** D-18: how a delivery offer was produced, so dispatch quality is measurable. */
export const dispatchMode = pgEnum('dispatch_mode', ['AUTO_NEAREST', 'BROADCAST', 'MANUAL']);

/** PUSH and IN_APP are active in V1. EMAIL blocked by D-25, SMS by D-34. */
export const notificationChannel = pgEnum('notification_channel', [
  'PUSH',
  'IN_APP',
  'EMAIL',
  'SMS',
  'WHATSAPP',
]);

export const notificationStatus = pgEnum('notification_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'READ',
]);

export const notificationCategory = pgEnum('notification_category', [
  'ORDER',
  'PROMOTION',
  'ACCOUNT',
  'SUPPORT',
]);

export const pushPermission = pgEnum('push_permission', ['GRANTED', 'DENIED', 'DEFAULT']);

export const reviewStatus = pgEnum('review_status', ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN']);

export const ticketStatus = pgEnum('ticket_status', [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
  'CLOSED',
]);

export const ticketPriority = pgEnum('ticket_priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export const ticketCategory = pgEnum('ticket_category', [
  'PAYMENT',
  'DELIVERY',
  'PRODUCT',
  'REFUND',
  'COUPON',
  'ACCOUNT',
  'VENDOR',
  'OTHER',
]);

export const auditAction = pgEnum('audit_action', [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'STATUS_CHANGE',
  'APPROVE',
  'REJECT',
  'REFUND',
  'ASSIGN',
  'EXPORT',
  'SETTING_CHANGE',
  'CASH_DEPOSIT_VERIFY',
  'PII_REVEAL',
]);

/**
 * D-33. A native enum keeps referential integrity on every translation table.
 * `supported_locales` is the admin-visible lookup; adding a language means
 * extending both, which is a deliberate deploy-time action.
 */
export const localeCode = pgEnum('locale_code', ['en', 'hi']);

/** D-12 cash custody chain. */
export const cashEntryType = pgEnum('cash_entry_type', [
  'COLLECTION',
  'DEPOSIT',
  'ADJUSTMENT',
  'WRITE_OFF',
]);

export const cashDepositStatus = pgEnum('cash_deposit_status', [
  'DECLARED',
  'VERIFIED',
  'REJECTED',
  'PARTIAL',
]);

export const cashDepositMethod = pgEnum('cash_deposit_method', [
  'BANK_TRANSFER',
  'OFFICE_CASH',
  'UPI',
]);

/** V1 collects COD in cash only. */
export const codCollectionMethod = pgEnum('cod_collection_method', ['CASH']);

export const vendorDocType = pgEnum('vendor_doc_type', [
  'GST',
  'PAN',
  'FSSAI',
  'SHOP_LICENSE',
  'ADDRESS_PROOF',
  'CANCELLED_CHEQUE',
]);

export const driverDocType = pgEnum('driver_doc_type', [
  'DL',
  'AADHAAR',
  'PAN',
  'RC',
  'INSURANCE',
  'POLICE_VERIFICATION',
  'PHOTO',
]);

export const vehicleType = pgEnum('vehicle_type', ['BIKE', 'SCOOTER', 'BICYCLE', 'CAR', 'VAN']);

export const earningType = pgEnum('earning_type', [
  'DELIVERY_FEE',
  'INCENTIVE',
  'TIP',
  'ADJUSTMENT',
  'PENALTY',
]);

export const payeeType = pgEnum('payee_type', ['VENDOR', 'DRIVER']);

export const payoutStatus = pgEnum('payout_status', ['DRAFT', 'APPROVED', 'PAID', 'FAILED']);

export const bannerPlacement = pgEnum('banner_placement', [
  'HOME_HERO',
  'HOME_STRIP',
  'CATEGORY',
  'OFFERS',
]);

export const targetAudience = pgEnum('target_audience', [
  'ALL',
  'NEW_USERS',
  'RETURNING',
  'SEGMENT',
]);

export const campaignType = pgEnum('campaign_type', ['NOTIFICATION', 'COUPON_DROP', 'BANNER']);

export const campaignStatus = pgEnum('campaign_status', [
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
]);

export const contentStatus = pgEnum('content_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const cmsPageType = pgEnum('cms_page_type', ['LEGAL', 'INFO', 'LANDING']);

/** D-14 BLOCKED: no invoice is generated in V1; the enum exists for later. */
export const sellerType = pgEnum('seller_type', ['PLATFORM', 'VENDOR']);

export const systemEventSeverity = pgEnum('system_event_severity', [
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);

export const webhookDirection = pgEnum('webhook_direction', ['INBOUND', 'OUTBOUND']);

/** D-19: who is attempting a cancellation. */
export const cancellationActorRole = pgEnum('cancellation_actor_role', [
  'CUSTOMER',
  'VENDOR',
  'ADMIN',
]);

export const paymentMethodScope = pgEnum('payment_method_scope', ['ALL', 'PREPAID', 'COD']);
