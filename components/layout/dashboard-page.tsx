import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Standard dashboard page frame.
 *
 * Every vendor, driver and admin page uses this so the heading level, spacing and
 * "not built yet" messaging are identical across ~77 routes rather than drifting
 * per file.
 *
 * WHY A SHARED PLACEHOLDER IS HONEST HERE: these routes exist so navigation, route
 * gating, deep links and the permission map are real and testable now. The data
 * behind them needs authentication (TASK 003) and the feature tasks that own each
 * screen. Stating that plainly is better than a fake chart, which would imply
 * working software and hide which screens are actually done.
 */
export function DashboardPage({
  title,
  description,
  /** Permission required, admin only. Shown so the mapping is visible while reviewing. */
  permission,
  pendingLabel,
  pendingDescription,
  children,
}: {
  title: string;
  description?: string;
  permission?: string;
  pendingLabel: string;
  pendingDescription: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {permission && (
            <Badge variant="neutral" data-testid="dashboard-permission">
              {permission}
            </Badge>
          )}
        </div>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>

      {children}

      <div
        className="border-border rounded-[var(--radius-card)] border border-dashed p-4"
        data-testid="dashboard-pending"
      >
        <p className="text-sm font-medium">{pendingLabel}</p>
        <p className="text-muted-foreground mt-1 text-sm">{pendingDescription}</p>
      </div>
    </div>
  );
}
