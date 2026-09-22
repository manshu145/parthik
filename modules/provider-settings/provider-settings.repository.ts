import { eq, inArray } from 'drizzle-orm';
import { adminSettings } from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { decryptSecret, encryptSecret } from '@/lib/security/secret-box';

export const PROVIDER_FIELDS = [
  { key: 'maps.provider', label: 'Maps provider', secret: false },
  { key: 'maps.google_server_key', label: 'Google Maps server key', secret: true },
  { key: 'maps.google_browser_key', label: 'Google Maps browser key', secret: true },
  { key: 'payments.provider', label: 'Payments provider', secret: false },
  { key: 'payments.razorpay_key_id', label: 'Razorpay key ID', secret: true },
  { key: 'payments.razorpay_key_secret', label: 'Razorpay key secret', secret: true },
  { key: 'payments.razorpay_webhook_secret', label: 'Razorpay webhook secret', secret: true },
  { key: 'firebase.project_id', label: 'Firebase project ID', secret: false },
  { key: 'firebase.api_key', label: 'Firebase web API key', secret: true },
  { key: 'firebase.service_account_email', label: 'Firebase service account email', secret: false },
  { key: 'firebase.service_account_private_key', label: 'Firebase private key', secret: true },
  { key: 'analytics.ga4_measurement_id', label: 'GA4 measurement ID', secret: false },
  { key: 'analytics.ga4_api_secret', label: 'GA4 API secret', secret: true },
] as const;

export type ProviderSettingKey = (typeof PROVIDER_FIELDS)[number]['key'];

export async function listProviderSettings() {
  const db = await getDb();
  const rows = await db
    .select({ key: adminSettings.key, value: adminSettings.value })
    .from(adminSettings)
    .where(
      inArray(
        adminSettings.key,
        PROVIDER_FIELDS.map((field) => field.key)
      )
    );
  const configured = new Map(rows.map((row) => [row.key, readStored(row.value)]));
  return PROVIDER_FIELDS.map((field) => ({
    ...field,
    configured: Boolean(configured.get(field.key)),
    value: field.secret ? '' : (configured.get(field.key) ?? ''),
  }));
}

export async function saveProviderSettings(
  values: Partial<Record<ProviderSettingKey, string>>,
  userId: string
) {
  const db = await getDb();
  for (const field of PROVIDER_FIELDS) {
    const incoming = values[field.key]?.trim();
    if (!incoming) continue;
    const stored = field.secret ? await encryptSecret(incoming) : incoming;
    await db
      .insert(adminSettings)
      .values({
        key: field.key,
        value: { stored },
        valueType: 'string',
        groupName: 'providers',
        label: field.label,
        isSensitive: field.secret,
        requiredPermission: 'setting:manage_sensitive',
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: adminSettings.key,
        set: {
          value: { stored },
          isSensitive: field.secret,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
  }
}

export async function readProviderSetting(key: ProviderSettingKey): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(eq(adminSettings.key, key))
    .limit(1);
  const stored = row ? readStored(row.value) : null;
  if (!stored) return null;
  const field = PROVIDER_FIELDS.find((candidate) => candidate.key === key);
  return field?.secret ? decryptSecret(stored) : stored;
}

function readStored(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('stored' in value)) return null;
  return typeof value.stored === 'string' ? value.stored : null;
}
