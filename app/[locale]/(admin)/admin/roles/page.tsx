import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { RoleManagement } from '@/components/admin/access-management';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminRoleManagement } from '@/modules/admin-access';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('roles'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('role:manage');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [{ roles, permissions }, t] = await Promise.all([
    listAdminRoleManagement(),
    getTranslations('adminNav'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" data-testid="admin-roles">
      <div>
        <h1 className="text-xl font-semibold">{t('roles')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Database-backed permission matrix. Changes affect authorization on the next request.
        </p>
      </div>
      <RoleManagement roles={roles} permissions={permissions} />
    </div>
  );
}
