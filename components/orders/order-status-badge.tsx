'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { toneForStatus, type OrderStatusView } from '@/lib/order/view';

/**
 * One status, one label, one colour — decided in ONE place.
 *
 * The status appears on the list card, the detail header and the tracker. Three copies of a
 * status-to-colour switch is three chances for "cancelled" to be green on one screen.
 */
export function OrderStatusBadge({ status }: { status: OrderStatusView }) {
  const t = useTranslations('orders');

  return (
    <Badge variant={toneForStatus(status)} data-testid={`order-status-${status}`}>
      {t(`status.${status}`)}
    </Badge>
  );
}
