import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { requireCurrentPermission } from '@/lib/auth/current-actor';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { permissionsForRole } from '@/modules/identity';
import {
  listProviderSettings,
  PROVIDER_FIELDS,
  saveProviderSettings,
} from '@/modules/provider-settings';

export const dynamic = 'force-dynamic';

const providerSettingKeys = new Set<string>(PROVIDER_FIELDS.map((field) => field.key));

const selectorValues: Record<string, readonly string[]> = {
  'maps.provider': ['auto', 'google', 'mock'],
  'payments.provider': ['auto', 'razorpay', 'mock'],
};

export async function GET(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    await requireCurrentPermission('setting:manage_sensitive');
    return apiSuccess({ settings: await listProviderSettings() }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFrom(request);

  try {
    const actor = await requireCurrentPermission('setting:manage_sensitive');
    const parsed = z
      .record(z.string(), z.string().max(10000))
      .safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      throw new ValidationError('Invalid provider settings payload.');
    }

    const unknownKeys = Object.keys(parsed.data).filter((key) => !providerSettingKeys.has(key));
    if (unknownKeys.length > 0) {
      throw new ValidationError('Unsupported provider setting fields were supplied.', {
        setting: unknownKeys,
      });
    }

    for (const [key, supportedValues] of Object.entries(selectorValues)) {
      const incoming = parsed.data[key]?.trim();
      if (incoming && !supportedValues.includes(incoming)) {
        throw new ValidationError('Choose a supported provider.', {
          [key]: [`Allowed values: ${supportedValues.join(', ')}.`],
        });
      }
    }

    if (!Object.values(parsed.data).some((value) => value.trim().length > 0)) {
      throw new ValidationError(
        'Enter at least one value to save. Leave fields blank to keep their current values.'
      );
    }

    const actingRole =
      actor.roles.find(
        (grant) =>
          grant.scopeType === 'GLOBAL' &&
          permissionsForRole(grant.roleKey).has('setting:manage_sensitive')
      )?.roleKey ?? null;

    await saveProviderSettings(parsed.data, actor.userId, {
      actorRole: actingRole,
      requestId,
    });
    return apiSuccess({ settings: await listProviderSettings() }, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
