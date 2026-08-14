import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared layout for every non-happy-path UX state (master spec §25).
 *
 * These components are deliberately PRESENTATIONAL ONLY — they take strings as
 * props rather than reading translations themselves. That keeps components/
 * free of business and i18n coupling (docs/ARCHITECTURE.md §5.1) and lets both
 * server and client callers use them without duplicating a client boundary.
 */

export interface StateShellProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Every empty/error state must offer a next action (master spec §25). */
  action?: ReactNode;
  /** Support reference, shown on error states so a ticket can be traced. */
  reference?: { label: string; value: string };
  className?: string;
  /** Politeness for assistive tech. Errors assert; loading is polite. */
  live?: 'polite' | 'assertive' | 'off';
  role?: 'status' | 'alert';
}

export function StateShell({
  icon,
  title,
  description,
  action,
  reference,
  className,
  live = 'off',
  role,
}: StateShellProps) {
  return (
    <div
      {...(role ? { role } : {})}
      {...(live !== 'off' ? { 'aria-live': live } : {})}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className
      )}
    >
      {icon ? (
        <div className="text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      ) : null}

      <h2 className="text-foreground text-base font-semibold">{title}</h2>

      {description ? (
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      ) : null}

      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}

      {reference ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {reference.label}: <code className="font-mono">{reference.value}</code>
        </p>
      ) : null}
    </div>
  );
}
