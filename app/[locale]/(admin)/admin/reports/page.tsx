import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { OperationSnapshot } from '@/components/admin/operation-snapshot';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminOperation } from '@/modules/admin-operations';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('reports'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('report:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [snapshot, t] = await Promise.all([
    readAdminOperation('report:view'),
    getTranslations('adminNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-reports">
      <div>
        <h1 className="text-xl font-semibold">{t('reports')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Operational 30-day order and GMV report generated directly from production data.
        </p>
      </div>
      <OperationSnapshot snapshot={snapshot} permission="report:view" />
    </div>
  );
}
