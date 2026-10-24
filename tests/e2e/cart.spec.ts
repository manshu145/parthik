import { expect, test, type Page } from '@playwright/test';

/**
 * Cart E2E tests (TASK 008).
 *
 * Exercised end to end with no database: the guest cart persists in a cookie while
 * every price is re-read from the catalogue on the server.
 *
 * Fixture facts: atta ₹289 (MRP ₹325), toor dal ₹175, milk ₹72 stock 25,
 * tomatoes stock 0, floor cleaner stock 15. Seeded zone: ₹25 delivery, free above
 * ₹199, ₹99 minimum order, pincode 452001.
 */

/**
 * Chooses a serviceable location, which the cart needs before it can quote fees.
 *
 * Wrapped in `toPass` because a click delivered before React has hydrated is simply
 * lost — there is no handler yet — and retrying the interaction is the only reliable
 * alternative to an arbitrary sleep.
 */
async function chooseLocation(page: Page, prefix = '') {
  await page.goto(`${prefix}/`);

  await expect(async () => {
    await page.getByTestId('location-trigger').click();
    await expect(page.getByTestId('location-sheet')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.getByTestId('location-pincode').fill('452001');
  await page.getByRole('button', { name: /^(Check|देखें)$/ }).click();
  await expect(page.getByTestId('location-serviceable')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('location-sheet')).toHaveCount(0);
}

/**
 * Adds a product and waits for the server to confirm.
 *
 * The confirmation matters: without it the test races the request and a later cart
 * assertion fails for reasons that have nothing to do with the cart.
 */
async function addProduct(page: Page, slug: string, prefix = '') {
  await page.goto(`${prefix}/products/${slug}`);

  const button = page.getByTestId('add-to-cart');
  await expect(button).toBeEnabled();

  await expect(async () => {
    await button.click();
    // The button switches to its "added" state only after a 2xx response.
    await expect(button).toContainText(/Added|कार्ट में जोड़ा गया/, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe('cart API', () => {
  test('starts empty', async ({ request }) => {
    const response = await request.get('/api/v1/cart');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.data.cart.lines).toEqual([]);
    expect(body.data.cart.issues.map((i: { code: string }) => i.code)).toContain('CART_EMPTY');
  });

  test('is never cached', async ({ request }) => {
    // A cached cart is how someone sees a total that no longer applies.
    const response = await request.get('/api/v1/cart');

    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('rejects a request carrying a price', async ({ request }) => {
    // The schema is strict, so a client cannot smuggle a price in.
    const response = await request.post('/api/v1/cart/items', {
      data: { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1, unitPricePaise: 1 },
    });

    expect(response.status()).toBe(422);
  });

  test('rejects a non-uuid variant', async ({ request }) => {
    const response = await request.post('/api/v1/cart/items', {
      data: { variantId: 'not-a-uuid', quantity: 1 },
    });

    expect(response.status()).toBe(422);
  });

  test('404s an unknown variant', async ({ request }) => {
    const response = await request.post('/api/v1/cart/items', {
      data: { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    });

    expect(response.status()).toBe(404);
  });

  test('rejects a quantity above the per-line guardrail', async ({ request }) => {
    const response = await request.post('/api/v1/cart/items', {
      data: { variantId: '00000000-0000-4000-8000-000000000000', quantity: 999 },
    });

    // Validation fires before the variant is even looked up.
    expect(response.status()).toBe(422);
  });
});

test.describe('cart flow', () => {
  test('adds a product and updates the header badge', async ({ page }) => {
    await addProduct(page, 'demo-atta-5kg');

    // The badge is server-rendered, so it proves the cookie round-tripped.
    await expect(page.getByTestId('cart-trigger')).toContainText('1');
  });

  test('prices the cart from the database, not the client', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-atta-5kg');
    await page.goto('/cart');

    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-line-total')).toContainText('₹289');
    // ₹289 clears the ₹199 threshold, so delivery is free and the total is ₹289.
    await expect(page.getByTestId('cart-grand-total')).toContainText('₹289');
  });

  test('shows the delivery fee and the free-delivery gap below the threshold', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-toor-dal-1kg'); // ₹175
    await page.goto('/cart');

    // ₹175 + ₹25 delivery = ₹200, and ₹24 more earns free delivery.
    await expect(page.getByTestId('cart-grand-total')).toContainText('₹200');
    await expect(page.getByTestId('cart-free-delivery-gap')).toBeVisible();
  });

  test('increases and decreases quantity, recomputing the total server-side', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-toor-dal-1kg');
    await page.goto('/cart');

    await page.getByTestId('cart-increase').click();
    await expect(page.getByTestId('cart-quantity')).toContainText('2');
    // 2 × ₹175 = ₹350, over the threshold, so delivery is now free.
    await expect(page.getByTestId('cart-grand-total')).toContainText('₹350');

    await page.getByTestId('cart-decrease').click();
    await expect(page.getByTestId('cart-quantity')).toContainText('1');
    await expect(page.getByTestId('cart-grand-total')).toContainText('₹200');
  });

  test('removes a line and shows the empty state', async ({ page }) => {
    await addProduct(page, 'demo-atta-5kg');
    await page.goto('/cart');

    await page.getByTestId('cart-remove').click();

    await expect(page.getByTestId('cart-line')).toHaveCount(0);
    await expect(page.getByTestId('cart-trigger')).not.toContainText('1');
  });

  test('persists across a reload', async ({ page }) => {
    await addProduct(page, 'demo-atta-5kg');
    await page.goto('/cart');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);

    await page.reload();

    // The cookie is what makes this work without a database.
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
  });

  test('shows MRP savings', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-atta-5kg');
    await page.goto('/cart');

    // Total savings combine BOTH sources: ₹36 off MRP (₹325 → ₹289) plus the ₹25
    // delivery fee waived by clearing the ₹199 threshold.
    await expect(page.getByTestId('cart-savings')).toContainText('₹61');
  });

  test('NEVER renders a tax line while D-14 is blocked', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-atta-5kg');
    await page.goto('/cart');

    const summary = page.getByTestId('cart-summary');
    // "₹0 GST" would assert a tax treatment nobody has authorised.
    await expect(summary).not.toContainText(/GST|tax|कर/i);
  });

  test('blocks a cart below the store minimum order', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-bananas-6pc'); // ₹49, below the ₹99 minimum
    await page.goto('/cart');

    await expect(page.getByTestId('cart-issue-min-order')).toBeVisible();
    await expect(page.getByTestId('cart-checkout')).toBeDisabled();
  });

  test('asks for a location before quoting fees', async ({ page }) => {
    await addProduct(page, 'demo-atta-5kg');
    await page.goto('/cart');

    await expect(page.getByTestId('cart-issue-location')).toBeVisible();
  });

  test('will not add an out-of-stock product', async ({ page }) => {
    await page.goto('/products/demo-tomatoes-1kg');

    // Disabled rather than hidden, with the reason visible above it.
    await expect(page.getByTestId('add-to-cart')).toBeDisabled();
    await expect(page.getByTestId('product-stock')).toContainText(/Out of stock/i);
  });

  test('caps the increase button at available stock', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-cleaning-liquid-1l'); // stock 15
    await page.goto('/cart');

    // Rather than inviting the customer to exceed stock and then refusing.
    for (let index = 0; index < 14; index += 1) {
      await page.getByTestId('cart-increase').click();
      await expect(page.getByTestId('cart-quantity')).toContainText(String(index + 2));
    }

    await expect(page.getByTestId('cart-increase')).toBeDisabled();
  });

  test('shows the drawer with server totals', async ({ page }) => {
    await chooseLocation(page);
    await addProduct(page, 'demo-atta-5kg');

    await page.getByTestId('cart-trigger').click();

    await expect(page.getByTestId('cart-drawer')).toBeVisible();
    await expect(page.getByTestId('cart-total')).toContainText('₹289');
  });

  test('says fees are unknown in the drawer without a location', async ({ page }) => {
    await addProduct(page, 'demo-atta-5kg');
    await page.getByTestId('cart-trigger').click();

    // Rendering ₹0 for an unknown fee would be a promise we have not made.
    await expect(page.getByTestId('cart-quote-incomplete')).toBeVisible();
  });

  test('rejects mixing stores (D-11) — single store fixture keeps this additive', async ({
    page,
  }) => {
    // Only one demo store exists, so two products must coexist happily. The
    // rejection path is covered exhaustively in the unit tests.
    await chooseLocation(page);
    await addProduct(page, 'demo-atta-5kg');
    await addProduct(page, 'demo-toor-dal-1kg');
    await page.goto('/cart');

    await expect(page.getByTestId('cart-line')).toHaveCount(2);
  });

  test('is noindex', async ({ page }) => {
    await page.goto('/cart');

    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('cart in Hindi', () => {
  test('adds and prices a cart in Hindi', async ({ page }) => {
    await chooseLocation(page, '/hi');
    await addProduct(page, 'demo-atta-5kg', '/hi');
    await page.goto('/hi/cart');

    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    // Product names are localised from the catalogue.
    await expect(page.getByText('डेमो गेहूँ का आटा')).toBeVisible();
    await expect(page.getByTestId('cart-grand-total')).toContainText('₹');
  });

  test('shows the empty state in Hindi', async ({ page }) => {
    await page.goto('/hi/cart');

    await expect(page.getByText('आपकी कार्ट खाली है')).toBeVisible();
  });
});
