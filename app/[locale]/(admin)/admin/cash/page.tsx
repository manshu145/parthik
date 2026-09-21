import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AdminCashBoard } from '@/components/admin/cash-board';
import { AccessDenied } from '@/app/_components/access-denied';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { currentActorCan } from '@/lib/auth/current-actor';

/**
 * COD reconciliation — REAL SCREEN (docs/ROUTES.md §8, D-12).
 *
 * Gated on `cash:view`, and `cash:reconcile` is checked SEPARATELY to decide whether the verify
 * controls render at all. Two permissions on one page is deliberate: looking at the queue and
 * moving money out of it are different jobs, and `ADMIN_OPS` legitimately has the first without the
 * second (docs/SECURITY.md §5.2).
 *
 * The button is hidden AND the endpoint enforces it. Hiding alone would be decoration.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });

  return { title: t('cash'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('cash:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const canReconcile = await currentActorCan('cash:reconcile');
  const t = await getTranslations('adminNav');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('cash')}</h1>
      <AdminCashBoard canReconcile={canReconcile} />
    </div>
  );
}
