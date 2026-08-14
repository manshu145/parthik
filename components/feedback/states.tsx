import {
  AlertTriangle,
  FileQuestion,
  Inbox,
  Loader2,
  LockKeyhole,
  WifiOff,
  Wrench,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StateShell, type StateShellProps } from './state-shell';

/**
 * The complete set of UX states required by master spec §25 and the Definition
 * of Done (§40). Every feature must render the relevant ones:
 *
 *   loading · empty · success · error · disabled · unauthorized · not found ·
 *   offline
 *
 * `disabled` is a prop on the interactive primitives rather than a component.
 *
 * All copy is passed in as props so callers supply translated strings — these
 * work identically in English and Hindi.
 */

type StateProps = Omit<StateShellProps, 'icon' | 'live' | 'role'>;

export function LoadingState({ title, description, className }: StateProps) {
  return (
    <StateShell
      icon={<Loader2 className="size-6 animate-spin" />}
      title={title}
      {...(description ? { description } : {})}
      {...(className ? { className } : {})}
      role="status"
      live="polite"
    />
  );
}

export function EmptyState(props: StateProps) {
  return <StateShell icon={<Inbox className="size-7" />} {...props} role="status" />;
}

export function ErrorState(props: StateProps) {
  return (
    <StateShell
      icon={<AlertTriangle className="text-danger size-7" />}
      {...props}
      role="alert"
      live="assertive"
    />
  );
}

export function NotFoundState(props: StateProps) {
  return <StateShell icon={<FileQuestion className="size-7" />} {...props} role="status" />;
}

export function UnauthorizedState(props: StateProps) {
  return <StateShell icon={<LockKeyhole className="size-7" />} {...props} role="alert" />;
}

export function OfflineState(props: StateProps) {
  return (
    <StateShell icon={<WifiOff className="size-7" />} {...props} role="alert" live="assertive" />
  );
}

export function MaintenanceState(props: StateProps) {
  return <StateShell icon={<Wrench className="size-7" />} {...props} role="status" />;
}

/**
 * Generic list skeleton. Used while a collection loads so layout does not shift
 * when content arrives.
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

export { StateShell };
