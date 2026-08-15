import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { isUnauthenticatedPreview } from '@/lib/http/preview-access';
import { VENDOR_NAV_ITEMS, resolveNavItems } from '@/lib/navigation/dashboard-nav';

/**
 * Vendor surface layout (docs/ROUTES.md §6).
 *
 * Every vendor route requires a VENDOR role and an approved vendor, and every query
 * must be scoped to the authenticated vendor's id IN THE REPOSITORY LAYER — never
 * from a URL parameter. That enforcement arrives with TASK 003; the middleware gate
 * and this shell exist now so the surface is real and reviewable.
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

  const t = await getTranslations('vendorNav');

  return (
    <DashboardShell
      isUnauthenticatedPreview={isUnauthenticatedPreview()}
      surfaceLabel={t('surface')}
      homeHref="/vendor"
      groups={resolveNavItems(VENDOR_NAV_ITEMS, (key) => t(key))}
    >
      {children}
    </DashboardShell>
  );
}
