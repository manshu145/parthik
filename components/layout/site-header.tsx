'use client';

import { useTranslations } from 'next-intl';
import { User } from 'lucide-react';
import { DESKTOP_NAV_ITEMS } from '@/lib/navigation/nav-config';
import { Link } from '@/i18n/navigation';
import { NavIcon } from '@/components/ui/nav-icon';
import { LocaleSwitcher } from './locale-switcher';
import { LocationTrigger } from './location-selector';
import { CartTrigger } from './cart-drawer';
import { SearchBar } from './search-bar';
import { NavLink } from './nav-link';
import { cn } from '@/lib/utils';

/**
 * Site header, responsive across both breakpoints (master spec §7).
 *
 * DESKTOP (md and up): logo · location · search · categories · offers ·
 * favorites · account · cart — the full specified arrangement.
 *
 * MOBILE: logo · location · cart on the first row, with search on its own row
 * beneath. Primary navigation moves to the bottom bar, so it is not duplicated
 * here. Search stays visible rather than hidden behind an icon because it is a
 * primary action in grocery shopping.
 *
 * Sticky so location and search remain reachable while scrolling a long list.
 */
export function SiteHeader() {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');

  return (
    <header
      data-testid="site-header"
      className="border-border bg-background sticky top-0 border-b pt-[env(safe-area-inset-top)]"
      style={{ zIndex: 'var(--z-sticky)' }}
    >
      <div className="mx-auto w-full max-w-7xl px-4">
        {/* ---- Row 1 ---- */}
        <div className="flex h-14 items-center gap-2 md:h-16 md:gap-4">
          <Link
            href="/"
            aria-label={t('homeLink')}
            className={cn(
              'text-primary shrink-0 text-lg font-semibold tracking-tight md:text-xl',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
            )}
          >
            {tCommon('appName')}
          </Link>

          <LocationTrigger className="max-w-[45%] min-w-0 md:max-w-xs" />

          {/* Desktop-only search; mobile gets its own row. */}
          <div className="hidden min-w-0 flex-1 md:block">
            <SearchBar />
          </div>

          <nav aria-label={t('secondary')} className="ml-auto hidden items-center gap-1 md:flex">
            <ul className="flex items-center gap-1">
              {DESKTOP_NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <NavLink
                    item={item}
                    label={t(item.labelKey)}
                    className={cn(
                      'inline-flex min-h-[var(--size-tap-target)] items-center gap-2 rounded-[var(--radius-control)]',
                      'hover:bg-muted px-3 text-sm font-medium transition-colors'
                    )}
                    activeClassName="text-primary bg-brand-50"
                    inactiveClassName="text-foreground"
                  >
                    {item.icon ? <NavIcon name={item.icon} className="size-4" /> : null}
                    {t(item.labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <div className="hidden md:block">
              <LocaleSwitcher label={tCommon('changeLanguage')} />
            </div>

            {/* Account is a link, not a drawer: it routes to /account, which
                middleware gates for unauthenticated visitors. */}
            <Link
              href="/account"
              aria-label={t('account')}
              className={cn(
                'hidden size-11 items-center justify-center rounded-[var(--radius-control)] md:inline-flex',
                'hover:bg-muted transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
              )}
            >
              <User aria-hidden="true" className="size-5" />
            </Link>

            <CartTrigger />
          </div>
        </div>

        {/* ---- Row 2: mobile search ---- */}
        <div className="pb-3 md:hidden">
          <SearchBar />
        </div>
      </div>
    </header>
  );
}
