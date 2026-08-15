import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { isUnauthenticatedPreview } from '@/lib/http/preview-access';
import { ADMIN_NAV_SECTIONS, resolveNavSections } from '@/lib/navigation/dashboard-nav';

/**
 * Admin surface layout (docs/ROUTES.md §8).
 *
 * Navigation is grouped into sections because a flat 45-item sidebar is unusable.
 * Each item carries the permission §8 requires; a user without it must get the
 * `unauthorized` STATE in place, never a redirect loop. The permission engine
 * arrives with TASK 003 — the mapping is already recorded per route.
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

  const t = await getTranslations('adminNav');

  return (
    <DashboardShell
      isUnauthenticatedPreview={isUnauthenticatedPreview()}
      surfaceLabel={t('surface')}
      homeHref="/admin"
      groups={resolveNavSections(ADMIN_NAV_SECTIONS, (key) => t(key))}
    >
      {children}
    </DashboardShell>
  );
}
