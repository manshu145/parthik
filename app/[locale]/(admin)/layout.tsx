import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { AccessDenied } from '@/app/_components/access-denied';
import { checkPageSurface } from '@/lib/auth/page-guard';
import { isDevAuthEnabled } from '@/lib/http/preview-access';
import { ADMIN_NAV_SECTIONS, resolveNavSections } from '@/lib/navigation/dashboard-nav';

/**
 * Admin surface layout (docs/ROUTES.md §8).
 *
 * Navigation is grouped into sections because a flat 45-item sidebar is unusable.
 * Each item carries the permission §8 requires, and every admin page now asserts its
 * own permission via `requireCurrentPermission`, so a user without it gets the
 * `unauthorized` STATE in place rather than a redirect loop.
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
   * Surface guard. Reaching this dashboard requires a ADMIN role, checked
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
  const access = await checkPageSurface('admin');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const t = await getTranslations('adminNav');

  return (
    <DashboardShell
      isDevAuthSession={isDevAuthEnabled()}
      surfaceLabel={t('surface')}
      homeHref="/admin"
      groups={resolveNavSections(ADMIN_NAV_SECTIONS, (key) => t(key))}
    >
      {children}
    </DashboardShell>
  );
}
