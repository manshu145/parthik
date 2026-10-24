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
  return { title: t('auditLogs'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('audit:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [snapshot, t] = await Promise.all([
    readAdminOperation('audit:view'),
    getTranslations('adminNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-audit-logs">
      <div>
        <h1 className="text-xl font-semibold">{t('auditLogs')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Append-only administrative audit trail with actor, action, entity, reason and request
          reference.
        </p>
      </div>
      <OperationSnapshot snapshot={snapshot} permission="audit:view" />
    </div>
  );
}
