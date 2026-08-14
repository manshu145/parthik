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

  if (includeDemoData) {
    console.log('\nDemo data: APP_ENV=development detected.');
    console.log('  Run `pnpm seed:demo` to load demo vendors, products and coupons.');
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
