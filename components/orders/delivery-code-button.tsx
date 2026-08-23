'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Reveals the delivery code to the customer (D-20).
 *
 * A BUTTON RATHER THAN A FIELD ON THE PAGE, because revealing the code CREATES one. Only the hash
 * is stored, so there is nothing to read back — which is the point: a database dump, a log line or
 * a support screenshot can never expose a live code. The cost is that each reveal replaces the
 * previous code, so the customer asks for it when the driver is actually standing there.
 *
 * That is also why the copy warns before the second tap: a customer who reveals a new code while
 * the driver is mid-typing has just invalidated the one being entered.
 */
export function DeliveryCodeButton({ orderId }: { orderId: string }) {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');

  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = useCallback(async () => {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/orders/${orderId}/delivery-code`, { method: 'POST' });

      const payload = (await response.json()) as {
        success: boolean;
        data?: { otp: string };
        error?: { message?: string };
      };

      if (!response.ok || !payload.success || !payload.data) {
        // The server's message distinguishes "reissued too many times" from "already delivered",
        // and those need different reactions from the customer.
        setError(payload.error?.message ?? tCommon('retry'));
        return;
      }

      setCode(payload.data.otp);
    } catch {
      setError(tCommon('retry'));
    } finally {
      setPending(false);
    }
  }, [orderId, tCommon]);

  if (code) {
    return (
      <Card data-testid="order-delivery-code">
        <CardContent className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium">{t('deliveryCode.title')}</p>
          {/* Wide tracking and a large size: this gets read out loud across a doorway. */}
          <p
            className="font-mono text-3xl tracking-[0.3em]"
            data-testid="order-delivery-code-value"
          >
            {code}
          </p>
          <p className="text-muted-foreground text-sm">{t('deliveryCode.share')}</p>
          <p className="text-muted-foreground text-xs">{t('deliveryCode.replaceWarning')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        onClick={() => void reveal()}
        disabled={pending}
        data-testid="order-reveal-code"
      >
        {pending ? tCommon('loading') : t('deliveryCode.reveal')}
      </Button>

      {error && (
        <p className="text-danger text-sm" role="alert" data-testid="order-delivery-code-error">
          {error}
        </p>
      )}
    </div>
  );
}
