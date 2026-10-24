'use client';

import { useCallback, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Customer cancellation, with the reason as a REQUIRED field.
 *
 * The button is rendered only when the server said this order is cancellable, and the server
 * checks again on submit. Both, deliberately: the state can change between render and click —
 * the vendor accepts the order while the customer is typing — and the customer must be told
 * that rather than seeing a silent failure.
 *
 * 🔴 NO REFUND AMOUNT IS PROMISED HERE. D-19a has not set the percentages, so the copy says
 * what will happen (the order stops, any payment is reversed by support) without quoting a
 * figure the platform has not agreed to pay.
 */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const reasonFieldId = useId();

  const [isOpen, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !payload.success) {
        // The server's message is used verbatim: it distinguishes "the window has passed"
        // from "this can no longer be cancelled", and that difference tells the customer
        // whether contacting support is worth their time.
        setError(payload.error?.message ?? tCommon('retry'));
        return;
      }

      setOpen(false);
      // Re-renders the server component, so the status, the timeline and the disappearance of
      // this button all come from the server rather than from optimistic local state.
      router.refresh();
    } catch {
      setError(tCommon('retry'));
    } finally {
      setPending(false);
    }
  }, [orderId, reason, router, tCommon]);

  if (!isOpen) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="order-cancel-open">
        {t('cancel.action')}
      </Button>
    );
  }

  return (
    <Card data-testid="order-cancel-form">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-sm font-medium">{t('cancel.title')}</p>
        <p className="text-muted-foreground text-sm">{t('cancel.description')}</p>

        <label className="text-sm font-medium" htmlFor={reasonFieldId}>
          {t('cancel.reasonLabel')}
        </label>
        <Input
          id={reasonFieldId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('cancel.reasonPlaceholder')}
          maxLength={300}
          disabled={pending}
        />

        {error && (
          <p className="text-danger text-sm" role="alert" data-testid="order-cancel-error">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void submit()}
            // A three-character minimum matches the API schema, so the button cannot submit
            // something the server will reject.
            disabled={pending || reason.trim().length < 3}
            data-testid="order-cancel-confirm"
          >
            {pending ? t('cancel.pending') : t('cancel.confirm')}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancel.keep')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
