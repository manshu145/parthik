'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { usePathname } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { NavIcon } from '@/components/ui/nav-icon';
import { isNavItemActive } from '@/lib/navigation/nav-config';
import type { ResolvedDashboardNavSection } from '@/lib/navigation/dashboard-nav';
import { cn } from '@/lib/utils';

/**
 * Shared shell for the vendor, driver and admin surfaces.
 *
 * One component for all three because the structure is identical — sidebar on
 * desktop, off-canvas drawer on mobile, one `<main>` landmark — and three copies
 * would drift. The differences (nav content, brand label, home href) are props.
 *
 * DRIVER NOTE: docs/ROUTES.md §7 requires large tap targets and a single-column
 * layout, so nav rows are 44px minimum everywhere rather than only on the driver
 * surface.
 */

export interface DashboardShellProps {
  children: ReactNode;
  /**
   * True when the middleware let this render without a session because auth is
   * not configured yet. Shown as a banner so nobody mistakes it for a hole.
   */
  isUnauthenticatedPreview?: boolean;
  /** Translated surface name, e.g. "Vendor" — shown beside the brand. */
  surfaceLabel: string;
  homeHref: string;
  /**
   * Navigation with labels ALREADY TRANSLATED by the layout.
   *
   * Deliberately not a translate function: functions cannot cross the server /
   * client boundary, and passing one crashed every dashboard route.
   *
   * A single section with `title: null` renders as a flat list.
   */
  groups: readonly ResolvedDashboardNavSection[];
}

export function DashboardShell({
  children,
  isUnauthenticatedPreview = false,
  surfaceLabel,
  homeHref,
  groups,
}: DashboardShellProps) {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const [isNavOpen, setNavOpen] = useState(false);

  const nav = (
    <nav aria-label={surfaceLabel} className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          {group.title && (
            <h2 className="text-muted-foreground px-3 pt-2 text-[0.6875rem] font-semibold tracking-wide uppercase">
              {group.title}
            </h2>
          )}

          {group.items.map((item) => {
            const active = isNavItemActive(pathname, item);

            return (
              <Link
                key={item.id}
                href={item.href}
                // Closing on navigate matters on mobile: leaving the drawer open
                // over the page a customer just asked for is disorienting.
                onClick={() => setNavOpen(false)}
                aria-current={active ? 'page' : undefined}
                data-testid="dashboard-nav-item"
                className={cn(
                  'flex min-h-[var(--size-tap-target)] items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-muted text-foreground'
                )}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="border-border bg-background sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-3"
        data-testid="dashboard-header"
      >
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={isNavOpen}
          aria-label={isNavOpen ? tCommon('close') : t('openNavigation')}
          data-testid="dashboard-nav-toggle"
          className="hover:bg-muted flex size-11 items-center justify-center rounded-[var(--radius-control)] lg:hidden"
        >
          {isNavOpen ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>

        <Link href={homeHref} className="flex items-baseline gap-2 font-semibold">
          {tCommon('appName')}
          <span className="text-muted-foreground text-xs font-normal">{surfaceLabel}</span>
        </Link>

        {/* Back to the storefront: these surfaces are otherwise a dead end. */}
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground ml-auto text-xs underline-offset-2 hover:underline"
        >
          {t('backToStore')}
        </Link>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside
          className="border-border hidden w-64 shrink-0 overflow-y-auto border-r p-2 lg:block"
          data-testid="dashboard-sidebar"
        >
          {nav}
        </aside>

        {/* Mobile drawer. Rendered only when open so its links are not focusable
            behind the page. */}
        {isNavOpen && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setNavOpen(false)}
              className="bg-foreground/40 fixed inset-0 top-14 z-20 lg:hidden"
            />
            <aside
              className="bg-background border-border fixed top-14 bottom-0 left-0 z-30 w-72 overflow-y-auto border-r p-2 lg:hidden"
              data-testid="dashboard-drawer"
            >
              {nav}
            </aside>
          </>
        )}

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none">
          {isUnauthenticatedPreview && (
            <p
              role="status"
              data-testid="dashboard-preview-notice"
              className="border-warning bg-warning/10 mb-4 rounded-[var(--radius-control)] border p-3 text-xs"
            >
              {t('previewNotice')}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
