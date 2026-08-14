/**
 * DEVELOPMENT-ONLY demo data.
 *
 * ⚠️ This file must NEVER run against staging or production. `db/seed/index.ts`
 * refuses to load it unless `APP_ENV` is `development` or `test`, because demo
 * vendors and products appearing in a real catalogue would be a genuine incident,
 * not just untidy.
 *
 * Everything here is obviously fictional: names are placeholders, phone numbers
 * use the reserved 555 range, and no real customer, vendor or driver data is
 * present.
 */

import type { Locale } from '@/i18n/routing';

/** Reserved test numbers; never a real subscriber. */
const TEST_PHONE_PREFIX = '+91555000';

export const DEV_USERS: Array<{
  ref: string;
  firebaseUid: string;
  phone: string;
  fullName: string;
  role: string;
  preferredLocale: Locale;
}> = [
  {
    ref: 'admin',
    firebaseUid: 'dev-firebase-uid-admin',
    phone: `${TEST_PHONE_PREFIX}001`,
    fullName: 'Dev Super Admin',
    role: 'SUPER_ADMIN',
    preferredLocale: 'en',
  },
  {
    ref: 'vendor-owner',
    firebaseUid: 'dev-firebase-uid-vendor',
    phone: `${TEST_PHONE_PREFIX}002`,
    fullName: 'Dev Vendor Owner',
    role: 'VENDOR_OWNER',
    preferredLocale: 'en',
  },
  {
    ref: 'driver',
    firebaseUid: 'dev-firebase-uid-driver',
    phone: `${TEST_PHONE_PREFIX}003`,
    fullName: 'Dev Driver',
    role: 'DRIVER',
    // Hindi by default, so the driver surface is exercised in both locales.
    preferredLocale: 'hi',
  },
  {
    ref: 'customer',
    firebaseUid: 'dev-firebase-uid-customer',
    phone: `${TEST_PHONE_PREFIX}004`,
    fullName: 'Dev Customer',
    role: 'CUSTOMER',
    preferredLocale: 'en',
  },
];

export const DEV_VENDOR = {
  businessName: 'Demo Kirana Store',
  legalName: 'Demo Kirana Store Pvt Ltd',
  slug: 'demo-kirana-store',
  contactPhone: `${TEST_PHONE_PREFIX}002`,
  /** D-15: recorded for calculation only; no automated settlement. */
  commissionRate: '12.00',
};

export const DEV_STORE = {
  name: 'Demo Kirana — Central',
  slug: 'demo-kirana-central',
  line1: '12 Demo Market Road',
  city: 'Indore',
  state: 'Madhya Pradesh',
  pincode: '452001',
  latitude: '22.719568',
  longitude: '75.857727',
  deliveryRadiusKm: 6,
  minOrderPaise: 9_900,
  avgPrepTimeMinutes: 20,
  codEnabled: true,
};

/**
 * Demo catalogue.
 *
 * Prices are integer paise. Hindi names are provided for every product so the
 * bilingual read path is genuinely exercised — with English-only demo data, a
 * broken locale fallback would look fine in development.
 */
export const DEV_PRODUCTS: Array<{
  slug: string;
  categorySlug: string;
  mrpPaise: number;
  pricePaise: number;
  unitLabel: string;
  stock: number;
  translations: Record<Locale, { name: string; shortDescription: string }>;
}> = [
  {
    slug: 'demo-atta-5kg',
    categorySlug: 'staples',
    mrpPaise: 32_500,
    pricePaise: 28_900,
    unitLabel: '5 kg',
    stock: 40,
    translations: {
      en: { name: 'Demo Whole Wheat Atta', shortDescription: 'Stone-ground whole wheat flour' },
      hi: { name: 'डेमो गेहूँ का आटा', shortDescription: 'चक्की से पिसा गेहूँ का आटा' },
    },
  },
  {
    slug: 'demo-toor-dal-1kg',
    categorySlug: 'staples',
    mrpPaise: 19_500,
    pricePaise: 17_500,
    unitLabel: '1 kg',
    stock: 60,
    translations: {
      en: { name: 'Demo Toor Dal', shortDescription: 'Unpolished split pigeon peas' },
      hi: { name: 'डेमो तूर दाल', shortDescription: 'बिना पॉलिश की तूर दाल' },
    },
  },
  {
    slug: 'demo-full-cream-milk-1l',
    categorySlug: 'milk-curd',
    mrpPaise: 7_200,
    pricePaise: 7_200,
    unitLabel: '1 L',
    stock: 25,
    translations: {
      en: { name: 'Demo Full Cream Milk', shortDescription: 'Pasteurised, 6% fat' },
      hi: { name: 'डेमो फ़ुल क्रीम दूध', shortDescription: 'पाश्चुरीकृत, 6% फैट' },
    },
  },
  {
    slug: 'demo-bananas-6pc',
    categorySlug: 'fresh-fruits',
    mrpPaise: 6_000,
    pricePaise: 4_900,
    unitLabel: '6 pcs',
    stock: 80,
    translations: {
      en: { name: 'Demo Bananas', shortDescription: 'Ripe robusta bananas' },
      hi: { name: 'डेमो केले', shortDescription: 'पके रोबस्टा केले' },
    },
  },
  {
    slug: 'demo-tomatoes-1kg',
    categorySlug: 'fresh-vegetables',
    mrpPaise: 4_500,
    pricePaise: 3_900,
    unitLabel: '1 kg',
    stock: 0,
    translations: {
      en: { name: 'Demo Tomatoes', shortDescription: 'Fresh hybrid tomatoes' },
      hi: { name: 'डेमो टमाटर', shortDescription: 'ताज़े हाइब्रिड टमाटर' },
    },
  },
  {
    // English-only on purpose: exercises the Hindi→English fallback path, which
    // is otherwise easy to ship broken.
    slug: 'demo-cleaning-liquid-1l',
    categorySlug: 'household',
    mrpPaise: 21_000,
    pricePaise: 18_500,
    unitLabel: '1 L',
    stock: 15,
    translations: {
      en: { name: 'Demo Floor Cleaner', shortDescription: 'Citrus surface cleaner' },
    } as Record<Locale, { name: string; shortDescription: string }>,
  },
];

export const DEV_COUPONS: Array<{
  code: string;
  couponType: 'FLAT' | 'PERCENTAGE' | 'FREE_DELIVERY';
  discountValue: number;
  minCartPaise: number;
  maxDiscountPaise?: number;
  firstOrderOnly: boolean;
  translations: Record<Locale, { name: string; description: string }>;
}> = [
  {
    code: 'DEMOFIRST50',
    couponType: 'FLAT',
    discountValue: 5_000,
    minCartPaise: 19_900,
    firstOrderOnly: true,
    translations: {
      en: { name: '₹50 off first order', description: 'On orders above ₹199' },
      hi: { name: 'पहले ऑर्डर पर ₹50 छूट', description: '₹199 से ऊपर के ऑर्डर पर' },
    },
  },
  {
    code: 'DEMOFREEDEL',
    couponType: 'FREE_DELIVERY',
    discountValue: 0,
    minCartPaise: 9_900,
    firstOrderOnly: false,
    translations: {
      en: { name: 'Free delivery', description: 'On orders above ₹99' },
      hi: { name: 'मुफ़्त डिलीवरी', description: '₹99 से ऊपर के ऑर्डर पर' },
    },
  },
];
