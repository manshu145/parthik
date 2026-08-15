/* eslint-disable no-console */
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb, type Database } from '@/lib/db/client';
import { getServerEnv } from '@/lib/config/env';
import * as schema from '@/db/schema';
import {
  ADMIN_SETTINGS,
  CANCELLATION_POLICIES,
  CATEGORIES,
  DELIVERY_ZONES,
  FEATURE_FLAGS,
  INTENTIONALLY_UNSEEDED,
  NOTIFICATION_TEMPLATES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SUPPORTED_LOCALES,
} from './reference-data';
import { DEV_COUPONS, DEV_PRODUCTS, DEV_STORE, DEV_USERS, DEV_VENDOR } from './dev-data';

/**
 * Seed runner.
 *
 * Two clearly separated concerns:
 *
 *   REFERENCE DATA — permissions, roles, locales, zones, categories, templates,
 *   settings, flags. Idempotent configuration, safe in any environment.
 *
 *   DEMO DATA — vendors, products, coupons. Development and test only, and hard
 *   blocked elsewhere.
 *
 * Everything uses upsert-by-natural-key so re-running converges rather than
 * duplicating. A seed you are afraid to re-run is a seed nobody runs.
 */

interface SeedSummary {
  inserted: Record<string, number>;
  skipped: string[];
}

async function seedReferenceData(db: Database): Promise<SeedSummary> {
  const inserted: Record<string, number> = {};

  // ---- Locales (D-33) ----
  for (const locale of SUPPORTED_LOCALES) {
    await db
      .insert(schema.supportedLocales)
      .values({
        code: locale.code,
        name: locale.name,
        nativeName: locale.nativeName,
        isDefault: locale.isDefault,
        displayOrder: locale.displayOrder,
      })
      .onConflictDoUpdate({
        target: schema.supportedLocales.code,
        set: { name: locale.name, nativeName: locale.nativeName },
      });
  }
  inserted.supported_locales = SUPPORTED_LOCALES.length;

  // ---- Permissions ----
  for (const permission of PERMISSIONS) {
    const [resource, action] = permission.key.split(':');
    await db
      .insert(schema.permissions)
      .values({
        key: permission.key,
        resource: resource ?? permission.key,
        action: action ?? 'unknown',
        description: permission.description,
      })
      .onConflictDoUpdate({
        target: schema.permissions.key,
        set: { description: permission.description },
      });
  }
  inserted.permissions = PERMISSIONS.length;

  // ---- Roles ----
  const roleKeys = Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>;
  for (const key of roleKeys) {
    await db
      .insert(schema.roles)
      .values({
        key: key as (typeof schema.roleKey.enumValues)[number],
        name: String(key)
          .split('_')
          .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
          .join(' '),
        isSystem: true,
      })
      .onConflictDoNothing({ target: schema.roles.key });
  }
  inserted.roles = roleKeys.length;

  // ---- Role → permission mapping ----
  const allPermissions = await db
    .select({ id: schema.permissions.id, key: schema.permissions.key })
    .from(schema.permissions);
  const permissionByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  let mappings = 0;
  for (const key of roleKeys) {
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.key, key as (typeof schema.roleKey.enumValues)[number]))
      .limit(1);
    if (!role) continue;

    const granted = ROLE_PERMISSIONS[key] ?? [];
    const keys = granted[0] === '*' ? allPermissions.map((p) => p.key) : (granted as string[]);

    for (const permissionKey of keys) {
      const permissionId = permissionByKey.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Role ${String(key)} references unknown permission "${permissionKey}"`);
      }
      await db
        .insert(schema.rolePermissions)
        .values({ roleId: role.id, permissionId })
        .onConflictDoNothing();
      mappings += 1;
    }
  }
  inserted.role_permissions = mappings;

  // ---- Delivery zones and pincodes (D-17) ----
  for (const zone of DELIVERY_ZONES) {
    const [row] = await db
      .insert(schema.deliveryZones)
      .values({
        code: zone.code,
        name: zone.name,
        city: zone.city,
        state: zone.state,
        baseDeliveryFeePaise: zone.baseDeliveryFeePaise,
        freeDeliveryThresholdPaise: zone.freeDeliveryThresholdPaise,
        minOrderPaise: zone.minOrderPaise,
        avgDeliveryMinutes: zone.avgDeliveryMinutes,
      })
      .onConflictDoUpdate({
        target: schema.deliveryZones.code,
        set: {
          baseDeliveryFeePaise: zone.baseDeliveryFeePaise,
          freeDeliveryThresholdPaise: zone.freeDeliveryThresholdPaise,
        },
      })
      .returning({ id: schema.deliveryZones.id });

    if (!row) continue;

    for (const pincode of zone.pincodes) {
      await db
        .insert(schema.zonePincodes)
        .values({ deliveryZoneId: row.id, pincode })
        .onConflictDoNothing();
    }
  }
  inserted.delivery_zones = DELIVERY_ZONES.length;

  // ---- Categories with EN + HI translations ----
  let categoryCount = 0;
  let categoryTranslationCount = 0;

  for (const category of CATEGORIES) {
    const [parent] = await db
      .insert(schema.categories)
      .values({
        slug: category.slug,
        displayOrder: category.displayOrder,
        isFeatured: category.isFeatured,
      })
      .onConflictDoUpdate({
        target: schema.categories.slug,
        set: { displayOrder: category.displayOrder, isFeatured: category.isFeatured },
      })
      .returning({ id: schema.categories.id });

    if (!parent) continue;
    categoryCount += 1;

    for (const [locale, content] of Object.entries(category.translations)) {
      await db
        .insert(schema.categoryTranslations)
        .values({
          categoryId: parent.id,
          locale: locale as 'en' | 'hi',
          name: content.name,
          description: content.description ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.categoryTranslations.categoryId, schema.categoryTranslations.locale],
          set: { name: content.name },
        });
      categoryTranslationCount += 1;
    }

    for (const child of category.children ?? []) {
      const [childRow] = await db
        .insert(schema.categories)
        .values({
          slug: child.slug,
          parentId: parent.id,
          displayOrder: child.displayOrder,
        })
        .onConflictDoUpdate({
          target: schema.categories.slug,
          set: { parentId: parent.id, displayOrder: child.displayOrder },
        })
        .returning({ id: schema.categories.id });

      if (!childRow) continue;
      categoryCount += 1;

      for (const [locale, content] of Object.entries(child.translations)) {
        await db
          .insert(schema.categoryTranslations)
          .values({
            categoryId: childRow.id,
            locale: locale as 'en' | 'hi',
            name: content.name,
          })
          .onConflictDoUpdate({
            target: [schema.categoryTranslations.categoryId, schema.categoryTranslations.locale],
            set: { name: content.name },
          });
        categoryTranslationCount += 1;
      }
    }
  }
  inserted.categories = categoryCount;
  inserted.category_translations = categoryTranslationCount;

  // ---- Notification templates, EN + HI ----
  let templateCount = 0;
  for (const template of NOTIFICATION_TEMPLATES) {
    for (const [locale, content] of Object.entries(template.translations)) {
      await db
        .insert(schema.notificationTemplates)
        .values({
          eventKey: template.eventKey,
          channel: template.channel,
          locale: locale as 'en' | 'hi',
          subject: content.subject ?? null,
          body: content.body,
          variables: template.variables,
          version: 1,
        })
        .onConflictDoUpdate({
          target: [
            schema.notificationTemplates.eventKey,
            schema.notificationTemplates.channel,
            schema.notificationTemplates.locale,
            schema.notificationTemplates.version,
          ],
          set: { body: content.body, subject: content.subject ?? null },
        });
      templateCount += 1;
    }
  }
  inserted.notification_templates = templateCount;

  // ---- Admin settings ----
  for (const setting of ADMIN_SETTINGS) {
    await db
      .insert(schema.adminSettings)
      .values({
        key: setting.key,
        value: setting.value,
        valueType: setting.valueType,
        groupName: setting.groupName,
        label: setting.label,
        description: setting.description ?? null,
        isSensitive: setting.isSensitive ?? false,
        requiredPermission: setting.requiredPermission ?? null,
      })
      // Values are NOT overwritten on re-run: an operator may have tuned them,
      // and a seed must never silently revert production configuration.
      .onConflictDoUpdate({
        target: schema.adminSettings.key,
        set: { label: setting.label, description: setting.description ?? null },
      });
  }
  inserted.admin_settings = ADMIN_SETTINGS.length;

  // ---- Feature flags ----
  for (const flag of FEATURE_FLAGS) {
    await db
      .insert(schema.featureFlags)
      .values({ key: flag.key, description: flag.description, isEnabled: flag.isEnabled })
      .onConflictDoUpdate({
        target: schema.featureFlags.key,
        set: { description: flag.description },
      });
  }
  inserted.feature_flags = FEATURE_FLAGS.length;

  // ---- Cancellation policy: conservative seed only (D-19a) ----
  for (const policy of CANCELLATION_POLICIES) {
    await db
      .insert(schema.cancellationPolicies)
      .values({
        actorRole: policy.actorRole,
        fromStatus: policy.fromStatus as (typeof schema.orderStatus.enumValues)[number],
        isAllowed: policy.isAllowed,
        refundPercent: policy.refundPercent,
        refundDeliveryFee: policy.refundDeliveryFee,
        requiresReason: policy.requiresReason,
        restock: policy.restock,
        paymentMethodScope: policy.paymentMethodScope,
        priority: policy.priority,
      })
      .onConflictDoNothing();
  }
  inserted.cancellation_policies = CANCELLATION_POLICIES.length;

  return { inserted, skipped: Object.keys(INTENTIONALLY_UNSEEDED) };
}

/**
 * Demo catalogue — DEVELOPMENT AND TEST ONLY.
 *
 * Loads the vendor, store, products, variants and inventory that
 * `db/seed/dev-data.ts` describes, so a Postgres database matches what the
 * in-memory catalog repository serves. If these two drift, the fake stops being
 * evidence of anything.
 *
 * The caller MUST gate this on APP_ENV — demo products in a real catalogue would
 * be an incident, not untidiness. `main()` refuses outside development/test.
 */
async function seedDemoData(db: Database): Promise<SeedSummary> {
  const inserted: Record<string, number> = {};

  const ownerFixture = DEV_USERS.find((user) => user.ref === 'vendor-owner');
  if (!ownerFixture) throw new Error('Missing the vendor-owner fixture in dev-data.ts.');

  // ---- Owner user ----
  // Roles and permissions are deliberately NOT assigned here: RBAC belongs to
  // TASK 003. This row exists only to satisfy vendors.owner_user_id.
  const [owner] = await db
    .insert(schema.users)
    .values({
      firebaseUid: ownerFixture.firebaseUid,
      phone: ownerFixture.phone,
      fullName: ownerFixture.fullName,
      preferredLocale: ownerFixture.preferredLocale,
    })
    .onConflictDoUpdate({
      target: schema.users.firebaseUid,
      set: { fullName: ownerFixture.fullName, phone: ownerFixture.phone },
    })
    .returning({ id: schema.users.id });

  if (!owner) throw new Error('Failed to upsert the demo vendor owner.');
  inserted.users = 1;

  // ---- Vendor ----
  const [vendor] = await db
    .insert(schema.vendors)
    .values({
      ownerUserId: owner.id,
      businessName: DEV_VENDOR.businessName,
      legalName: DEV_VENDOR.legalName,
      slug: DEV_VENDOR.slug,
      contactPhone: DEV_VENDOR.contactPhone,
      commissionRate: DEV_VENDOR.commissionRate,
      status: 'APPROVED',
      approvedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.vendors.slug,
      set: { businessName: DEV_VENDOR.businessName, status: 'APPROVED' },
    })
    .returning({ id: schema.vendors.id });

  if (!vendor) throw new Error('Failed to upsert the demo vendor.');
  inserted.vendors = 1;

  // ---- Store ----
  const [store] = await db
    .insert(schema.stores)
    .values({
      vendorId: vendor.id,
      name: DEV_STORE.name,
      slug: DEV_STORE.slug,
      status: DEV_STORE.status,
      line1: DEV_STORE.line1,
      city: DEV_STORE.city,
      state: DEV_STORE.state,
      pincode: DEV_STORE.pincode,
      latitude: DEV_STORE.latitude,
      longitude: DEV_STORE.longitude,
      deliveryRadiusKm: DEV_STORE.deliveryRadiusKm,
      minOrderPaise: DEV_STORE.minOrderPaise,
      avgPrepTimeMinutes: DEV_STORE.avgPrepTimeMinutes,
      codEnabled: DEV_STORE.codEnabled,
      // Defaults to false in the schema; an unbrowsable demo store is useless.
      isAcceptingOrders: true,
    })
    .onConflictDoUpdate({
      target: schema.stores.slug,
      set: { status: DEV_STORE.status, isAcceptingOrders: true },
    })
    .returning({ id: schema.stores.id });

  if (!store) throw new Error('Failed to upsert the demo store.');
  inserted.stores = 1;

  // ---- Products, translations, one default variant each, inventory ----
  let productCount = 0;
  let translationCount = 0;
  let variantCount = 0;
  let inventoryCount = 0;

  for (const fixture of DEV_PRODUCTS) {
    const [category] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(eq(schema.categories.slug, fixture.categorySlug))
      .limit(1);

    if (!category) {
      throw new Error(
        `Demo product "${fixture.slug}" references category "${fixture.categorySlug}", which reference data does not define.`
      );
    }

    const [product] = await db
      .insert(schema.products)
      .values({
        vendorId: vendor.id,
        storeId: store.id,
        categoryId: category.id,
        slug: fixture.slug,
        status: 'ACTIVE',
        unitLabel: fixture.unitLabel,
        mrpPaise: fixture.mrpPaise,
        pricePaise: fixture.pricePaise,
        publishedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.products.slug,
        set: {
          status: 'ACTIVE',
          mrpPaise: fixture.mrpPaise,
          pricePaise: fixture.pricePaise,
          unitLabel: fixture.unitLabel,
          categoryId: category.id,
        },
      })
      .returning({ id: schema.products.id });

    if (!product) continue;
    productCount += 1;

    for (const [locale, content] of Object.entries(fixture.translations)) {
      await db
        .insert(schema.productTranslations)
        .values({
          productId: product.id,
          locale: locale as 'en' | 'hi',
          name: content.name,
          shortDescription: content.shortDescription,
        })
        .onConflictDoUpdate({
          target: [schema.productTranslations.productId, schema.productTranslations.locale],
          set: { name: content.name, shortDescription: content.shortDescription },
        });
      translationCount += 1;
    }

    // One default variant per product. The schema permits only one
    // (`product_variants_default_key`), so this looks the existing row up rather
    // than relying on a conflict target a partial index cannot provide.
    const [existingVariant] = await db
      .select({ id: schema.productVariants.id })
      .from(schema.productVariants)
      .where(eq(schema.productVariants.productId, product.id))
      .limit(1);

    const variantId =
      existingVariant?.id ??
      (
        await db
          .insert(schema.productVariants)
          .values({
            productId: product.id,
            mrpPaise: fixture.mrpPaise,
            pricePaise: fixture.pricePaise,
            unitLabel: fixture.unitLabel,
            isDefault: true,
            displayOrder: 0,
          })
          .returning({ id: schema.productVariants.id })
      )[0]?.id;

    if (!variantId) continue;

    if (existingVariant) {
      await db
        .update(schema.productVariants)
        .set({ mrpPaise: fixture.mrpPaise, pricePaise: fixture.pricePaise })
        .where(eq(schema.productVariants.id, variantId));
    }
    variantCount += 1;

    await db
      .insert(schema.inventory)
      .values({
        variantId,
        storeId: store.id,
        quantityAvailable: fixture.stock,
        trackInventory: true,
      })
      .onConflictDoUpdate({
        target: schema.inventory.variantId,
        set: { quantityAvailable: fixture.stock },
      });
    inventoryCount += 1;
  }

  inserted.products = productCount;
  inserted.product_translations = translationCount;
  inserted.product_variants = variantCount;
  inserted.inventory = inventoryCount;

  // ---- Demo coupons ----
  let couponCount = 0;
  let couponTranslationCount = 0;
  let restrictionCount = 0;

  for (const fixture of DEV_COUPONS) {
    const [coupon] = await db
      .insert(schema.coupons)
      .values({
        code: fixture.code,
        couponType: fixture.couponType,
        discountValue: fixture.discountValue,
        minCartPaise: fixture.minCartPaise,
        ...(fixture.maxDiscountPaise === undefined
          ? {}
          : { maxDiscountPaise: fixture.maxDiscountPaise }),
        // A category-scoped coupon records its scope on the row as well as in
        // `coupon_restrictions`, so the two cannot disagree.
        scope: fixture.categorySlugs?.length ? 'CATEGORY' : 'CART',
        firstOrderOnly: fixture.firstOrderOnly,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: schema.coupons.code,
        set: {
          couponType: fixture.couponType,
          discountValue: fixture.discountValue,
          minCartPaise: fixture.minCartPaise,
          maxDiscountPaise: fixture.maxDiscountPaise ?? null,
          firstOrderOnly: fixture.firstOrderOnly,
          isActive: true,
        },
      })
      .returning({ id: schema.coupons.id });

    if (!coupon) continue;
    couponCount += 1;

    for (const [locale, content] of Object.entries(fixture.translations)) {
      await db
        .insert(schema.couponTranslations)
        .values({
          couponId: coupon.id,
          locale: locale as 'en' | 'hi',
          name: content.name,
          description: content.description,
        })
        .onConflictDoUpdate({
          target: [schema.couponTranslations.couponId, schema.couponTranslations.locale],
          set: { name: content.name, description: content.description },
        });
      couponTranslationCount += 1;
    }

    for (const categorySlug of fixture.categorySlugs ?? []) {
      const [category] = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.slug, categorySlug))
        .limit(1);

      if (!category) {
        throw new Error(
          `Demo coupon "${fixture.code}" references category "${categorySlug}", which reference data does not define.`
        );
      }

      await db
        .insert(schema.couponRestrictions)
        .values({
          couponId: coupon.id,
          restrictionType: 'CATEGORY',
          restrictionId: category.id,
        })
        .onConflictDoNothing();
      restrictionCount += 1;
    }
  }

  inserted.coupons = couponCount;
  inserted.coupon_translations = couponTranslationCount;
  inserted.coupon_restrictions = restrictionCount;

  return { inserted, skipped: [] };
}

async function main(): Promise<void> {
  const env = getServerEnv();
  const includeDemoData = env.APP_ENV === 'development';

  console.log(`\nSeeding Parthik reference data (APP_ENV=${env.APP_ENV})\n`);

  const db = await getDb();

  // Sanity check: uuidv7() is required by every primary key default.
  try {
    await db.execute(sql`select uuidv7()`);
  } catch {
    throw new Error(
      'uuidv7() is unavailable. It requires PostgreSQL 18+, or a compatible extension/function on older versions. See docs/DATABASE.md §1.'
    );
  }

  const summary = await seedReferenceData(db);

  console.log('Reference data:');
  for (const [table, rows] of Object.entries(summary.inserted)) {
    console.log(`  ${table.padEnd(28)} ${rows}`);
  }

  console.log('\nIntentionally not seeded:');
  for (const [table, reason] of Object.entries(INTENTIONALLY_UNSEEDED)) {
    console.log(`  ${table.padEnd(28)} ${reason}`);
  }

  // `pnpm seed:demo` sets SEED_DEMO=1. Demo rows are refused outside
  // development/test regardless of the flag.
  const demoRequested = process.env.SEED_DEMO === '1';

  if (demoRequested && !includeDemoData) {
    throw new Error(
      `Refusing to load demo data in APP_ENV="${env.APP_ENV}". Demo vendors and products must never reach staging or production.`
    );
  }

  if (demoRequested) {
    const demo = await seedDemoData(db);
    console.log('\nDemo data:');
    for (const [table, rows] of Object.entries(demo.inserted)) {
      console.log(`  ${table.padEnd(28)} ${rows}`);
    }
  } else if (includeDemoData) {
    console.log('\nDemo data: not loaded.');
    console.log('  Run `pnpm seed:demo` to load the demo vendor, store and products.');
  } else {
    console.log(`\nDemo data: SKIPPED — refusing to load demo rows in "${env.APP_ENV}".`);
  }

  await closeDb();
  console.log('\n✅ Seed complete.\n');
}

main().catch(async (error: unknown) => {
  console.error('\n❌ Seed failed:', error instanceof Error ? error.message : error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
