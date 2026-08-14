'use client';

import { useTranslations } from 'next-intl';
import { BOTTOM_NAV_ITEMS } from '@/lib/navigation/nav-config';
import { NavIcon } from '@/components/ui/nav-icon';
import { CountBadge } from '@/components/ui/badge';
import { useShell } from '@/components/providers/shell-provider';
import { NavLink } from './nav-link';
import { cn } from '@/lib/utils';

/**
 * Mobile bottom navigation (master spec §7).
 *
 * Home · Categories · Offers · Cart · Account — exactly five items, as specified.
 *
 * Details that matter on a real phone:
 *   - `pb-[env(safe-area-inset-bottom)]` keeps targets clear of the iOS home
 *     indicator, so the last row of pixels is not swallowed by the gesture area.
 *   - Every target is at least 44px tall (§24, §26).
 *   - Hidden on desktop, where the header carries navigation instead.
 *   - `aria-current="page"` marks the active tab, so it is not signalled by colour
 *     alone.
 */
export function BottomNav() {
  const t = useTranslations('nav');
  const { cart } = useShell();

  return (
    <nav
      aria-label={t('primary')}
      data-testid="bottom-nav"
      className={cn(
        'border-border bg-background fixed inset-x-0 bottom-0 border-t md:hidden',
        'pb-[env(safe-area-inset-bottom)]'
      )}
      style={{ zIndex: 'var(--z-sticky)' }}
    >
      <ul className="grid grid-cols-5">
        {BOTTOM_NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <NavLink
              item={item}
              label={t(item.labelKey)}
              className={cn(
                'relative flex min-h-[var(--size-tap-target)] flex-col items-center justify-center gap-1',
                'px-1 py-2 text-[0.6875rem] font-medium transition-colors'
              )}
              activeClassName="text-primary"
              inactiveClassName="text-muted-foreground"
            >
              <span className="relative">
                {item.icon ? <NavIcon name={item.icon} /> : null}
                {item.showsBadge ? (
                  <CountBadge
                    count={cart.itemCount}
                    srLabel={t('cartItemCount', { count: cart.itemCount })}
                  />
                ) : null}
              </span>
              <span className="truncate">{t(item.labelKey)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
