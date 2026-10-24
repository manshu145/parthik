import { requireCurrentActor } from '@/lib/auth/current-actor';
import { ValidationError } from '@/lib/errors';
import { apiError, apiSuccess, requestIdFrom } from '@/lib/http/api-response';
import { noStoreHeaders, resolveRequestLocale } from '@/lib/http/request-locale';
import { loadCart } from '@/lib/shell/cart-session';
import { getCheckoutService } from '@/modules/checkout';
import { quoteBodySchema } from '@/modules/checkout/checkout.schema';
import type { PaymentMethod } from '@/modules/checkout';

/**
 * POST /api/v1/checkout/quote (docs/API_SPEC.md §6, master spec §12).
 *
 * Returns what the order WOULD be: re-verified serviceability, re-read prices and stock,
 * the delivery fee for the chosen address, available payment methods with reasons for any
 * that are not, and every blocker standing between the customer and placing the order.
 *
 * A POST rather than a GET despite being a read, because the answer depends on a body
 * (address and payment method) and must never be cached — a cached quote is how someone
 * sees a total that no longer applies.
 *
 * 🔴 The response carries NO TAX LINE. D-14 is blocked, so no tax treatment is asserted —
 * not even a zero one (docs/ARCHITECTURE.md §11.2.2).
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const locale = resolveRequestLocale(request);

  try {
    // Checkout is inherently per-customer: there is no guest checkout in V1, because an
    // order needs an owner for tracking, support and refunds.
    const actor = await requireCurrentActor();

    // A body is optional: the first quote is requested before any choice is made.
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // Empty or unparseable body means "quote with my defaults".
    }

    const parsed = quoteBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid checkout request.',
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const [{ intent }, service] = await Promise.all([loadCart(), getCheckoutService()]);

    const quote = await service.quote({
      intent,
      locale,
      userId: actor.userId,
      addressId: parsed.data.addressId ?? null,
      paymentMethod: (parsed.data.paymentMethod as PaymentMethod | null) ?? null,
    });

    const response = apiSuccess({ quote }, { meta: { requestId, locale } });

    for (const [header, value] of Object.entries(noStoreHeaders(locale))) {
      response.headers.set(header, value);
    }

    return response;
  } catch (error) {
    return apiError(error, { requestId });
  }
}
