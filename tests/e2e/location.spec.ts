import { expect, test, type Page } from '@playwright/test';

/**
 * Location and serviceability E2E tests (TASK 005).
 *
 * These run against the REAL API routes with NO credentials configured, which is
 * the point: the mock maps provider and the in-memory zone repository must make the
 * whole flow exercisable on a fresh clone
 * (.kiro/steering/provider-credentials.md).
 *
 * Fixture data comes from the seeded Indore zone — 452001/452002/452003 are
 * serviceable, 110001 is deliberately not.
 */

const SERVICEABLE_PINCODE = '452001';
const UNSERVICEABLE_PINCODE = '110001';

const LOCALES = [
  {
    code: 'en',
    prefix: '',
    selectLocation: 'Select location',
    check: 'Check',
    deliversTo: 'We deliver to',
    doesNotDeliver: 'We do not deliver to',
  },
  {
    code: 'hi',
    prefix: '/hi',
    selectLocation: 'स्थान चुनें',
    check: 'देखें',
    deliversTo: 'में डिलीवरी करते हैं',
    doesNotDeliver: 'में डिलीवरी नहीं करते',
  },
] as const;

async function openLocationSheet(page: Page, prefix: string) {
  await page.goto(`${prefix}/`);
  await page.getByTestId('location-trigger').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('serviceability API', () => {
  test('returns a serviceable zone for a seeded pincode', async ({ request }) => {
    const response = await request.get(
      `/api/v1/location/serviceability?pincode=${SERVICEABLE_PINCODE}`
    );

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.isServiceable).toBe(true);
    expect(body.data.zone.city).toBe('Indore');
    // ₹25 fee, free above ₹199 — the approved D-17 initial rule, from seed data.
    expect(body.data.baseDeliveryFeePaise).toBe(2500);
    expect(body.data.freeDeliveryThresholdPaise).toBe(19900);
  });

  test('reports an out-of-zone pincode as unserviceable', async ({ request }) => {
    const response = await request.get(
      `/api/v1/location/serviceability?pincode=${UNSERVICEABLE_PINCODE}`
    );

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.isServiceable).toBe(false);
    expect(body.data.zone).toBeNull();
  });

  test('rejects a malformed pincode with 422', async ({ request }) => {
    const response = await request.get('/api/v1/location/serviceability?pincode=abc');

    expect(response.status()).toBe(422);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  test('rejects a missing pincode', async ({ request }) => {
    const response = await request.get('/api/v1/location/serviceability');

    expect(response.status()).toBe(422);
  });

  test('IGNORES an unexpected extra query parameter rather than trusting it', async ({
    request,
  }) => {
    // Query strings routinely carry tracking parameters (utm_*, fbclid, gclid), so
    // rejecting unknown ones outright would break shared links. The route reads
    // only the parameters it needs, which means a smuggled `zoneId` has no effect
    // at all — the zone is still resolved server-side from the pincode.
    const response = await request.get(
      `/api/v1/location/serviceability?pincode=${SERVICEABLE_PINCODE}&zoneId=attacker-zone&utm_source=x`
    );

    expect(response.status()).toBe(200);

    const body = await response.json();
    // The real zone, not the injected one.
    expect(body.data.zone.code).toBe('ZONE-001');
    expect(JSON.stringify(body)).not.toContain('attacker-zone');
  });
});

test.describe('autocomplete API', () => {
  test('returns suggestions for a known area', async ({ request }) => {
    const response = await request.get(
      '/api/v1/location/autocomplete?q=Palasia&sessionToken=e2e-session-token'
    );

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.suggestions.length).toBeGreaterThan(0);
    expect(body.data.suggestions[0].primaryText).toContain('Palasia');
  });

  test('requires a session token', async ({ request }) => {
    // The Places cost control, enforced at the edge rather than trusted.
    const response = await request.get('/api/v1/location/autocomplete?q=Palasia');

    expect(response.status()).toBe(422);
  });

  test('rejects a query below the minimum length', async ({ request }) => {
    const response = await request.get(
      '/api/v1/location/autocomplete?q=MG&sessionToken=e2e-session-token'
    );

    expect(response.status()).toBe(422);
  });
});

test.describe('reverse geocode API', () => {
  test('resolves an Indore coordinate to a serviceable address', async ({ request }) => {
    const response = await request.get('/api/v1/location/reverse-geocode?lat=22.7196&lng=75.8577');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.place.components.pincode).toBe('452001');
    expect(body.data.serviceability.isServiceable).toBe(true);
  });

  test('rejects coordinates outside India', async ({ request }) => {
    // Bounded to India, so no billable call is made for a meaningless coordinate.
    const response = await request.get('/api/v1/location/reverse-geocode?lat=51.5&lng=-0.12');

    expect(response.status()).toBe(422);
  });
});

test.describe('route estimate API', () => {
  test('returns road distance and duration', async ({ request }) => {
    const response = await request.post('/api/v1/location/route-estimate', {
      data: {
        origin: { latitude: 22.7196, longitude: 75.8577 },
        destination: { latitude: 22.7533, longitude: 75.8937 },
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.estimate.distanceMeters).toBeGreaterThan(0);
    expect(body.data.estimate.durationSeconds).toBeGreaterThan(0);
  });

  test('rejects a malformed body', async ({ request }) => {
    const response = await request.post('/api/v1/location/route-estimate', {
      data: { origin: { latitude: 22.7196 } },
    });

    expect(response.status()).toBe(422);
  });
});

test.describe('zones API', () => {
  test('lists active zones without exposing pincodes', async ({ request }) => {
    const response = await request.get('/api/v1/location/zones');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.zones.length).toBeGreaterThan(0);
    expect(body.data.zones[0].city).toBe('Indore');
    // Pincode lists are operational data, not public.
    expect(body.data.zones[0].pincodes).toBeUndefined();
  });
});

test.describe('select API', () => {
  test('sets the location cookie', async ({ request }) => {
    const response = await request.post('/api/v1/location/select', {
      data: { pincode: SERVICEABLE_PINCODE },
    });

    expect(response.status()).toBe(200);

    const cookie = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => header.value)
      .join('; ');

    expect(cookie).toContain('parthik_location');
  });

  test('REJECTS a client-supplied zoneId', async ({ request }) => {
    // Serviceability is resolved server-side from the pincode. Accepting a zone id
    // would let a client declare itself serviceable.
    const response = await request.post('/api/v1/location/select', {
      data: { pincode: SERVICEABLE_PINCODE, zoneId: 'attacker-zone' },
    });

    expect(response.status()).toBe(422);
  });
});

test.describe('development diagnostics', () => {
  test('reports the active providers', async ({ request }) => {
    const response = await request.get('/api/v1/diagnostics/providers');

    expect(response.status()).toBe(200);

    const body = await response.json();
    // No credentials in CI, so the mock must be active and flagged as a fallback.
    expect(body.data.maps.active).toBe('mock');
    expect(body.data.maps.serverKeyPresent).toBe(false);
  });

  test('never exposes key material', async ({ request }) => {
    const response = await request.get('/api/v1/diagnostics/providers');
    const text = await response.text();

    // Only booleans and provider names. Anything key-shaped here would be a leak.
    expect(text).not.toContain('AIza');
    expect(text).not.toMatch(/"(apiKey|serverKey|key)"\s*:\s*"[^"]+"/);
  });
});

test.describe('location selector UI', () => {
  for (const locale of LOCALES) {
    test(`[${locale.code}] sets a serviceable location and updates the header`, async ({
      page,
    }) => {
      await openLocationSheet(page, locale.prefix);

      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('location-pincode').fill(SERVICEABLE_PINCODE);
      await dialog.getByRole('button', { name: locale.check }).click();

      const outcome = page.getByTestId('location-serviceable');
      await expect(outcome).toBeVisible();
      await expect(outcome).toContainText(locale.deliversTo);
      // Terms are stated up front, so delivery cost is never a checkout surprise.
      await expect(outcome).toContainText('₹');

      // Header reflects the choice.
      await expect(page.getByTestId('location-trigger')).toContainText('Indore');
    });

    test(`[${locale.code}] states plainly that an area is not covered`, async ({ page }) => {
      await openLocationSheet(page, locale.prefix);

      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('location-pincode').fill(UNSERVICEABLE_PINCODE);
      await dialog.getByRole('button', { name: locale.check }).click();

      const outcome = page.getByTestId('location-unserviceable');
      await expect(outcome).toBeVisible();
      await expect(outcome).toContainText(UNSERVICEABLE_PINCODE);
    });

    test(`[${locale.code}] finds a location by searching`, async ({ page }) => {
      await openLocationSheet(page, locale.prefix);

      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('location-search').fill('Palasia');

      const suggestion = dialog.getByTestId('location-suggestion').first();
      await expect(suggestion).toBeVisible();
      await suggestion.click();

      await expect(page.getByTestId('location-serviceable')).toBeVisible();
    });
  }

  test('persists the chosen location across a reload', async ({ page }) => {
    await openLocationSheet(page, '');

    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('location-pincode').fill(SERVICEABLE_PINCODE);
    await dialog.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('location-serviceable')).toBeVisible();

    await page.reload();

    // Rendered from the cookie on the server, so it must be right on first paint
    // rather than appearing after hydration.
    await expect(page.getByTestId('location-trigger')).toContainText('Indore');
  });

  test('keeps the check button disabled until six digits are entered', async ({ page }) => {
    await openLocationSheet(page, '');

    const dialog = page.getByRole('dialog');
    const check = dialog.getByRole('button', { name: 'Check' });

    await expect(check).toBeDisabled();
    await dialog.getByTestId('location-pincode').fill('4520');
    await expect(check).toBeDisabled();
    await dialog.getByTestId('location-pincode').fill('452001');
    await expect(check).toBeEnabled();
  });

  test('is reachable and operable by keyboard', async ({ page }) => {
    await page.goto('/');

    const trigger = page.getByTestId('location-trigger');
    const dialog = page.getByRole('dialog');

    // The trigger must be focusable and activate with the keyboard, not only a tap.
    //
    // Wrapped in `toPass` because a keypress delivered before React has hydrated is
    // simply lost — there is no handler to receive it yet — and retrying the whole
    // interaction is the only reliable way to test this without an arbitrary sleep.
    await expect(async () => {
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    // Escape must close it, or a keyboard user is trapped in the sheet.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
