import type { ReactNode } from 'react';
import { DashboardPage } from '@/components/layout/dashboard-page';
import { checkPagePermission } from '@/lib/auth/page-guard';
import type { PermissionKey } from '@/modules/identity';
import { AccessDenied } from './access-denied';
import { readAdminOperation } from '@/modules/admin-operations';
import { OperationSnapshot } from '@/components/admin/operation-snapshot';

/**
 * A dashboard page that authorizes itself.
 *
 * Replaces the earlier arrangement where each page called a guard AND separately passed
 * a `permission` string to the presentational frame. Naming the permission twice meant
 * the two could disagree, and the failure was silent in the dangerous direction: the
 * badge would advertise `setting:manage_sensitive` while the guard checked something
 * weaker. Here it is named ONCE and the same value both gates and labels the page.
 *
 * The check runs before anything renders and is re-derived from the database, so a role
 * revoked mid-session is honoured immediately rather than at cookie expiry.
 */
export async function GuardedDashboardPage({
  permission,
  title,
  description,
  pendingLabel,
  pendingDescription,
  children,
}: {
  permission: PermissionKey;
  title: string;
  description?: string;
  pendingLabel: string;
  pendingDescription: string;
  children?: ReactNode;
}) {
  const decision = await checkPagePermission(permission);

  if (decision.status !== 'ok') {
    return <AccessDenied decision={decision} />;
  }

  const liveChildren = children ?? (
    <OperationSnapshot permission={permission} snapshot={await readAdminOperation(permission)} />
  );

  return (
    <DashboardPage
      title={title}
      permission={permission}
      {...(description ? { description } : {})}
      pendingLabel={pendingLabel}
      pendingDescription={pendingDescription}
    >
      {liveChildren}
    </DashboardPage>
  );
}
