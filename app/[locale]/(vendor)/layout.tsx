import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { AccessDenied } from '@/app/_components/access-denied';
import { checkPageSurface } from '@/lib/auth/page-guard';
import { isDevAuthEnabled } from '@/lib/http/preview-access';
import { VENDOR_NAV_ITEMS, resolveNavItems } from '@/lib/navigation/dashboard-nav';

/**
 * Vendor surface layout (docs/ROUTES.md §6).
 *
 * Every vendor route requires a VENDOR role, enforced by the surface guard below.
 * Query-level tenant scoping — every read bound to the authenticated vendor's id IN
 * THE REPOSITORY LAYER, never from a URL parameter — arrives with the vendor feature
 * work in TASK 013, which is when the first vendor-scoped query exists.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  /**
   * Surface guard. Reaching this dashboard requires a VENDOR role, checked
   * against the DATABASE rather than the session cookie, so a revoked role takes
   * effect immediately instead of at cookie expiry.
   *
   * Denials render IN PLACE rather than redirecting: the visitor may well be signed
   * in, and bouncing them to a login page they are already past is a loop.
   *
   * Deliberately duplicated with the per-page permission checks. A page added later
   * without its own check is still unreachable by the wrong role, so the cost of
   * forgetting is a locked door rather than an open one.
   */
  const access = await checkPageSurface('vendor');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const t = await getTranslations('vendorNav');

  return (
    <DashboardShell
      isDevAuthSession={isDevAuthEnabled()}
      surfaceLabel={t('surface')}
      homeHref="/vendor"
      groups={resolveNavItems(VENDOR_NAV_ITEMS, (key) => t(key))}
    >
      {children}
    </DashboardShell>
  );
}
