import { cn } from '@/lib/utils';

/**
 * Skeleton placeholder for loading states (master spec §24, §25).
 *
 * `aria-hidden` because a skeleton is decorative — the accessible loading
 * announcement is made by the surrounding LoadingState via aria-live, so screen
 * readers hear one clear message instead of a wall of empty boxes.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('bg-muted animate-pulse rounded-[var(--radius-control)]', className)}
      {...props}
    />
  );
}
