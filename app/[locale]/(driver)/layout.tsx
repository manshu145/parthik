import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { isUnauthenticatedPreview } from '@/lib/http/preview-access';
import { DRIVER_NAV_ITEMS, resolveNavItems } from '@/lib/navigation/dashboard-nav';

/**
 * Driver surface layout (docs/ROUTES.md §7).
 *
 * Single column with large tap targets: this is used one-handed, outdoors, often in
 * poor light. The shared shell already enforces 44px nav rows.
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

  const t = await getTranslations('driverNav');

  return (
    <DashboardShell
      isUnauthenticatedPreview={isUnauthenticatedPreview()}
      surfaceLabel={t('surface')}
      homeHref="/driver"
      groups={resolveNavItems(DRIVER_NAV_ITEMS, (key) => t(key))}
    >
      {children}
    </DashboardShell>
  );
}
