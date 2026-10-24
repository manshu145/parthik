'use client';

import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { ACCOUNT_NAV_ITEMS } from '@/lib/navigation/nav-config';
import { NavIcon } from '@/components/ui/nav-icon';
import { NavLink } from './nav-link';
import { cn } from '@/lib/utils';

/**
 * Account hub navigation (docs/ROUTES.md §5).
 *
 * Rendered as a list of rows: on mobile that is the familiar settings pattern, and
 * on desktop it becomes a sidebar. Items come from the shared navigation config,
 * so the account menu cannot drift out of step with the routes.
 *
 * Note `/orders` and `/favorites` are the CANONICAL routes; docs/ROUTES.md §5
 * resolves the `/account/orders` and `/account/favorites` variants as redirects to
 * avoid two implementations of one list.
 */
export function AccountNav() {
  const t = useTranslations('nav');

  return (
    <nav aria-label={t('account')} data-testid="account-nav">
      <ul className="divide-border border-border flex flex-col divide-y overflow-hidden rounded-[var(--radius-card)] border">
        {ACCOUNT_NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <NavLink
              item={item}
              label={t(item.labelKey)}
              className={cn(
                'flex min-h-[var(--size-tap-target)] items-center gap-3 px-4 py-3',
                'hover:bg-muted text-sm transition-colors'
              )}
              activeClassName="bg-brand-50 font-medium text-primary"
            >
              {item.icon ? <NavIcon name={item.icon} className="text-muted-foreground" /> : null}
              <span className="flex-1">{t(item.labelKey)}</span>
              <ChevronRight aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
