/**
 * Deterministic reference data (docs/DATABASE.md §13 "Seeding").
 *
 * This is CONFIGURATION, not test data: permissions, roles, locales, zones,
 * categories, notification templates and settings. It is idempotent and safe to
 * run repeatedly against any environment.
 *
 * Deliberately NOT seeded, and each for a documented reason:
 *   - `tax_rates`            — D-14 blocked; no tax assumption may be implemented
 *   - `cancellation_reasons` — the reason list is an unmade business decision
 *   - vendors/products/orders — demo data, see dev-data.ts (never production)
 */

import type { Locale } from '@/i18n/routing';
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_PERMISSION_MAP,
  WILDCARD_PERMISSION,
} from '@/modules/identity/permissions';

// ---------------------------------------------------------------------------
// Locales (D-33)
// ---------------------------------------------------------------------------

export const SUPPORTED_LOCALES: Array<{
  code: Locale;
  name: string;
  nativeName: string;
  isDefault: boolean;
  displayOrder: number;
}> = [
  { code: 'en', name: 'English', nativeName: 'English', isDefault: true, displayOrder: 0 },
  // Shown in its own script: a switcher labelled "Hindi" in Latin text is a poor
  // signal to the users who most need it.
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', isDefault: false, displayOrder: 1 },
];

// ---------------------------------------------------------------------------
// Permissions and roles (docs/SECURITY.md §5.2, §5.3)
// ---------------------------------------------------------------------------

/**
 * The catalogue itself lives in `modules/identity/permissions.ts`, and is
 * re-exported here rather than duplicated.
 *
 * The RBAC engine and this seeder MUST agree on every key. Two hand-maintained
 * lists would drift, and the failure mode of that drift is silent: a permission
 * granted in code but absent from the database denies access to a working
 * feature, and a permission seeded but unknown to the engine grants nothing.
 * Deriving both from one declaration removes the possibility.
 */
export const PERMISSIONS: Array<{ key: string; description: string }> = PERMISSION_KEYS.map(
  (key) => ({ key, description: PERMISSION_DESCRIPTIONS[key] })
);

export const ROLE_PERMISSIONS: Record<string, string[] | ['*']> = Object.fromEntries(
  ROLE_KEYS.map((roleKey) => {
    const granted = ROLE_PERMISSION_MAP[roleKey];
    return [
      roleKey,
      granted.length === 1 && granted[0] === WILDCARD_PERMISSION
        ? (['*'] as ['*'])
        : [...(granted as readonly string[])],
    ];
  })
);

// ---------------------------------------------------------------------------
// Delivery zones (D-17) — ₹199 free-delivery threshold as DATA, not a constant
// ---------------------------------------------------------------------------

export const DELIVERY_ZONES: Array<{
  code: string;
  name: string;
  city: string;
  state: string;
  baseDeliveryFeePaise: number;
  freeDeliveryThresholdPaise: number;
  minOrderPaise: number;
  avgDeliveryMinutes: number;
  pincodes: string[];
}> = [
  {
    code: 'ZONE-001',
    name: 'Central',
    city: 'Indore',
    state: 'Madhya Pradesh',
    // ₹25 delivery fee, waived above ₹199 — the approved initial business rule,
    // editable per zone by an admin.
    baseDeliveryFeePaise: 2_500,
    freeDeliveryThresholdPaise: 19_900,
    minOrderPaise: 9_900,
    avgDeliveryMinutes: 35,
    pincodes: ['452001', '452002', '452003'],
  },
];

// ---------------------------------------------------------------------------
// Category tree — Hindi is REQUIRED for categories (docs/ARCHITECTURE.md §12.6)
// ---------------------------------------------------------------------------

export const CATEGORIES: Array<{
  slug: string;
  displayOrder: number;
  isFeatured: boolean;
  translations: Record<Locale, { name: string; description?: string }>;
  children?: Array<{
    slug: string;
    displayOrder: number;
    translations: Record<Locale, { name: string }>;
  }>;
}> = [
  {
    slug: 'fruits-vegetables',
    displayOrder: 1,
    isFeatured: true,
    translations: {
      en: { name: 'Fruits & Vegetables', description: 'Fresh produce, daily' },
      hi: { name: 'फल और सब्ज़ियाँ', description: 'रोज़ ताज़ी उपज' },
    },
    children: [
      {
        slug: 'fresh-fruits',
        displayOrder: 1,
        translations: { en: { name: 'Fresh Fruits' }, hi: { name: 'ताज़े फल' } },
      },
      {
        slug: 'fresh-vegetables',
        displayOrder: 2,
        translations: { en: { name: 'Fresh Vegetables' }, hi: { name: 'ताज़ी सब्ज़ियाँ' } },
      },
    ],
  },
  {
    slug: 'dairy-bakery',
    displayOrder: 2,
    isFeatured: true,
    translations: {
      en: { name: 'Dairy & Bakery', description: 'Milk, bread, eggs' },
      hi: { name: 'डेयरी और बेकरी', description: 'दूध, ब्रेड, अंडे' },
    },
    children: [
      {
        slug: 'milk-curd',
        displayOrder: 1,
        translations: { en: { name: 'Milk & Curd' }, hi: { name: 'दूध और दही' } },
      },
      {
        slug: 'bread-eggs',
        displayOrder: 2,
        translations: { en: { name: 'Bread & Eggs' }, hi: { name: 'ब्रेड और अंडे' } },
      },
    ],
  },
  {
    slug: 'staples',
    displayOrder: 3,
    isFeatured: true,
    translations: {
      en: { name: 'Atta, Rice & Dal', description: 'Everyday staples' },
      hi: { name: 'आटा, चावल और दाल', description: 'रोज़ की ज़रूरी चीज़ें' },
    },
  },
  {
    slug: 'snacks-beverages',
    displayOrder: 4,
    isFeatured: false,
    translations: {
      en: { name: 'Snacks & Beverages' },
      hi: { name: 'स्नैक्स और पेय' },
    },
  },
  {
    slug: 'household',
    displayOrder: 5,
    isFeatured: false,
    translations: {
      en: { name: 'Household & Cleaning' },
      hi: { name: 'घरेलू और सफ़ाई' },
    },
  },
  {
    slug: 'personal-care',
    displayOrder: 6,
    isFeatured: false,
    translations: {
      en: { name: 'Personal Care' },
      hi: { name: 'व्यक्तिगत देखभाल' },
    },
  },
];

// ---------------------------------------------------------------------------
// Notification templates — EN + HI required for transactional events (D-33)
// ---------------------------------------------------------------------------

/**
 * V1 populates PUSH and IN_APP only. Email is blocked by D-25 and non-OTP SMS by
 * D-34, so no template exists for those channels — an empty channel is honest,
 * whereas a template with no adapter would imply a message that never sends.
 */
export const NOTIFICATION_TEMPLATES: Array<{
  eventKey: string;
  channel: 'PUSH' | 'IN_APP';
  translations: Record<Locale, { subject?: string; body: string }>;
  variables: string[];
}> = [
  {
    eventKey: 'order.placed',
    channel: 'PUSH',
    variables: ['orderNumber'],
    translations: {
      en: {
        subject: 'Order placed',
        body: 'Order {orderNumber} is confirmed. We will update you.',
      },
      hi: {
        subject: 'ऑर्डर मिल गया',
        body: 'ऑर्डर {orderNumber} पक्का हो गया। हम आपको जानकारी देंगे।',
      },
    },
  },
  {
    eventKey: 'order.accepted',
    channel: 'PUSH',
    variables: ['orderNumber', 'storeName'],
    translations: {
      en: { subject: 'Order accepted', body: '{storeName} accepted order {orderNumber}.' },
      hi: { subject: 'ऑर्डर स्वीकार', body: '{storeName} ने ऑर्डर {orderNumber} स्वीकार कर लिया।' },
    },
  },
  {
    eventKey: 'order.ready',
    channel: 'PUSH',
    variables: ['orderNumber'],
    translations: {
      en: { subject: 'Order ready', body: 'Order {orderNumber} is packed and awaiting pickup.' },
      hi: { subject: 'ऑर्डर तैयार', body: 'ऑर्डर {orderNumber} पैक हो गया, पिकअप का इंतज़ार है।' },
    },
  },
  {
    eventKey: 'delivery.driver_assigned',
    channel: 'PUSH',
    variables: ['orderNumber', 'driverName'],
    translations: {
      en: { subject: 'Driver assigned', body: '{driverName} will deliver order {orderNumber}.' },
      hi: { subject: 'ड्राइवर तय हुआ', body: '{driverName} ऑर्डर {orderNumber} पहुँचाएँगे।' },
    },
  },
  {
    eventKey: 'delivery.out_for_delivery',
    channel: 'PUSH',
    variables: ['orderNumber', 'otp'],
    translations: {
      en: {
        subject: 'Out for delivery',
        body: 'Order {orderNumber} is on the way. Share OTP {otp} with the driver.',
      },
      hi: {
        subject: 'डिलीवरी के लिए निकला',
        body: 'ऑर्डर {orderNumber} रास्ते में है। ड्राइवर को OTP {otp} बताएँ।',
      },
    },
  },
  {
    eventKey: 'delivery.delivered',
    channel: 'PUSH',
    variables: ['orderNumber'],
    translations: {
      en: { subject: 'Delivered', body: 'Order {orderNumber} has been delivered. Enjoy!' },
      hi: { subject: 'डिलीवर हो गया', body: 'ऑर्डर {orderNumber} पहुँचा दिया गया। धन्यवाद!' },
    },
  },
  {
    eventKey: 'order.cancelled',
    channel: 'PUSH',
    variables: ['orderNumber', 'reason'],
    translations: {
      en: { subject: 'Order cancelled', body: 'Order {orderNumber} was cancelled. {reason}' },
      hi: { subject: 'ऑर्डर रद्द', body: 'ऑर्डर {orderNumber} रद्द कर दिया गया। {reason}' },
    },
  },
  {
    eventKey: 'payment.failed',
    channel: 'PUSH',
    variables: ['orderNumber'],
    translations: {
      en: {
        subject: 'Payment failed',
        body: 'Payment for order {orderNumber} did not go through.',
      },
      hi: { subject: 'भुगतान असफल', body: 'ऑर्डर {orderNumber} का भुगतान पूरा नहीं हुआ।' },
    },
  },
  {
    eventKey: 'refund.completed',
    channel: 'IN_APP',
    variables: ['orderNumber', 'amount'],
    translations: {
      en: {
        subject: 'Refund processed',
        body: '{amount} for order {orderNumber} has been refunded.',
      },
      hi: { subject: 'रिफ़ंड हो गया', body: 'ऑर्डर {orderNumber} का {amount} रिफ़ंड कर दिया गया।' },
    },
  },
  {
    eventKey: 'vendor.order_new',
    channel: 'PUSH',
    variables: ['orderNumber', 'itemCount'],
    translations: {
      en: {
        subject: 'New order',
        body: 'Order {orderNumber} with {itemCount} items needs action.',
      },
      hi: {
        subject: 'नया ऑर्डर',
        body: 'ऑर्डर {orderNumber} में {itemCount} आइटम, कार्रवाई ज़रूरी।',
      },
    },
  },
  {
    eventKey: 'driver.delivery_offered',
    channel: 'PUSH',
    variables: ['orderNumber', 'distanceKm'],
    translations: {
      en: { subject: 'New delivery', body: 'Delivery {orderNumber}, {distanceKm} km away.' },
      hi: { subject: 'नई डिलीवरी', body: 'डिलीवरी {orderNumber}, {distanceKm} किमी दूर।' },
    },
  },
  {
    eventKey: 'driver.cash_limit_reached',
    channel: 'PUSH',
    variables: ['amount'],
    translations: {
      en: {
        subject: 'Deposit required',
        body: 'You are holding {amount}. Deposit it to receive more COD orders.',
      },
      hi: {
        subject: 'जमा करना ज़रूरी',
        body: 'आपके पास {amount} है। और COD ऑर्डर पाने के लिए जमा करें।',
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Admin settings (master spec §34)
// ---------------------------------------------------------------------------

export const ADMIN_SETTINGS: Array<{
  key: string;
  value: unknown;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  groupName: string;
  label: string;
  description?: string;
  isSensitive?: boolean;
  requiredPermission?: string;
}> = [
  // Business
  {
    key: 'business.name',
    value: 'Parthik',
    valueType: 'string',
    groupName: 'business',
    label: 'Business name',
  },
  {
    key: 'business.currency',
    value: 'INR',
    valueType: 'string',
    groupName: 'business',
    label: 'Currency',
  },
  {
    key: 'business.timezone',
    value: 'Asia/Kolkata',
    valueType: 'string',
    groupName: 'business',
    label: 'Timezone',
  },

  // Delivery (D-17). Zone rows override these platform-wide defaults.
  {
    key: 'delivery.default_fee_paise',
    value: 2_500,
    valueType: 'number',
    groupName: 'delivery',
    label: 'Default delivery fee (paise)',
  },
  {
    key: 'delivery.free_threshold_paise',
    value: 19_900,
    valueType: 'number',
    groupName: 'delivery',
    label: 'Free delivery threshold (paise)',
    description: '₹199 initial business rule (D-17). Editable per zone.',
  },
  {
    key: 'delivery.min_order_paise',
    value: 9_900,
    valueType: 'number',
    groupName: 'delivery',
    label: 'Minimum order value (paise)',
  },

  // COD controls (D-12). ⚠️ Launch VALUES need product confirmation; these are
  // conservative placeholders, not approved figures.
  {
    key: 'cod.max_order_value_paise',
    value: 250_000,
    valueType: 'number',
    groupName: 'cod',
    label: 'Maximum COD order value (paise)',
    description: 'Caps per-order exposure. Launch value needs confirmation.',
  },
  {
    key: 'cod.driver_cash_limit_paise',
    value: 500_000,
    valueType: 'number',
    groupName: 'cod',
    label: 'Driver cash-in-hand limit (paise)',
    description:
      'A driver above this is ineligible for further COD dispatch until they deposit. Primary loss control. Launch value needs confirmation.',
  },
  {
    key: 'cod.deposit_grace_hours',
    value: 24,
    valueType: 'number',
    groupName: 'cod',
    label: 'Cash deposit grace period (hours)',
  },

  // Inventory (D-16)
  {
    key: 'inventory.reservation_timeout_minutes',
    value: 15,
    valueType: 'number',
    groupName: 'inventory',
    label: 'Unpaid reservation timeout (minutes)',
    description: 'PENDING_PAYMENT orders are swept and stock released after this window.',
  },

  // Dispatch (D-18). ⚠️ Defaults need confirmation.
  {
    key: 'dispatch.offer_timeout_seconds',
    value: 45,
    valueType: 'number',
    groupName: 'dispatch',
    label: 'Driver offer timeout (seconds)',
  },
  {
    key: 'dispatch.max_attempts',
    value: 3,
    valueType: 'number',
    groupName: 'dispatch',
    label: 'Max sequential offers before broadcast',
  },
  {
    key: 'dispatch.escalation_minutes',
    value: 10,
    valueType: 'number',
    groupName: 'dispatch',
    label: 'Minutes before manual escalation',
  },
  {
    key: 'dispatch.candidate_prefilter_count',
    value: 10,
    valueType: 'number',
    groupName: 'dispatch',
    label: 'Haversine pre-filter size before Route Matrix',
    description: 'Cost control: a Route Matrix call across every online driver would be wasteful.',
  },

  // Tax — D-14 BLOCKED. Present so the setting exists, but disabled.
  {
    key: 'tax.enabled',
    value: false,
    valueType: 'boolean',
    groupName: 'tax',
    label: 'Tax calculation enabled',
    description: 'BLOCKED by D-14. Must stay false until the GST model is confirmed.',
    isSensitive: true,
    requiredPermission: 'setting:manage_sensitive',
  },

  // Platform
  {
    key: 'platform.maintenance_mode',
    value: false,
    valueType: 'boolean',
    groupName: 'platform',
    label: 'Maintenance mode',
    isSensitive: true,
    requiredPermission: 'setting:manage_sensitive',
  },
];

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const FEATURE_FLAGS: Array<{ key: string; description: string; isEnabled: boolean }> = [
  { key: 'push_notifications', description: 'Web push via FCM (D-26)', isEnabled: false },
  { key: 'cod_enabled', description: 'Cash on delivery (D-12)', isEnabled: true },
  { key: 'auto_dispatch', description: 'Auto-nearest driver dispatch (D-18)', isEnabled: false },
  { key: 'hindi_locale', description: 'Expose the Hindi locale switcher (D-33)', isEnabled: true },
  { key: 'reviews_enabled', description: 'Product and order reviews', isEnabled: false },
];

// ---------------------------------------------------------------------------
// Cancellation policy (D-19) — CONSERVATIVE SEED ONLY
// ---------------------------------------------------------------------------

/**
 * ⚠️ D-19a: the ENGINE is approved, the VALUES are not.
 *
 * Only the two rules explicitly stated in docs/DATABASE.md §6.3 are seeded:
 * a customer may cancel before ACCEPTED with a 100% refund, and an admin may
 * cancel at any pre-delivery status. Every other window, percentage, restocking
 * and driver-compensation rule requires product input and is deliberately absent
 * rather than invented.
 */
export const CANCELLATION_POLICIES: Array<{
  actorRole: 'CUSTOMER' | 'VENDOR' | 'ADMIN';
  fromStatus: string;
  isAllowed: boolean;
  refundPercent: string;
  refundDeliveryFee: boolean;
  requiresReason: boolean;
  restock: boolean;
  paymentMethodScope: 'ALL' | 'PREPAID' | 'COD';
  priority: number;
}> = [
  {
    actorRole: 'CUSTOMER',
    fromStatus: 'PENDING_PAYMENT',
    isAllowed: true,
    refundPercent: '100.00',
    refundDeliveryFee: true,
    requiresReason: false,
    restock: true,
    paymentMethodScope: 'ALL',
    priority: 10,
  },
  {
    actorRole: 'CUSTOMER',
    fromStatus: 'CONFIRMED',
    isAllowed: true,
    refundPercent: '100.00',
    refundDeliveryFee: true,
    requiresReason: false,
    restock: true,
    paymentMethodScope: 'ALL',
    priority: 10,
  },
  // Admin may cancel at any pre-delivery status. Reason is mandatory and the
  // action is audited.
  ...(
    [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'ASSIGNED',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
    ] as const
  ).map((fromStatus) => ({
    actorRole: 'ADMIN' as const,
    fromStatus,
    isAllowed: true,
    refundPercent: '100.00',
    refundDeliveryFee: true,
    requiresReason: true,
    restock: true,
    paymentMethodScope: 'ALL' as const,
    priority: 100,
  })),
];

/**
 * Tables intentionally left unseeded, with the reason recorded so a future
 * developer does not "fix" the omission.
 */
export const INTENTIONALLY_UNSEEDED: Record<string, string> = {
  tax_rates: 'D-14 BLOCKED — no tax assumption may be implemented',
  invoices: 'D-14 BLOCKED — no invoice is generated in V1',
  cancellation_reasons: 'Reason list is an unmade business decision (related to D-19a)',
  vendors: 'Demo data only — see db/seed/dev-data.ts, never production',
  products: 'Demo data only — see db/seed/dev-data.ts, never production',
};
