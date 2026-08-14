import { cn } from '@/lib/utils';

/**
 * Count badge, used for the cart item count and unread notifications.
 *
 * Caps the displayed value so a large number cannot break the layout, and
 * announces the real figure to assistive tech via `srLabel` — "99+" alone is not
 * useful to a screen reader.
 */
export function CountBadge({
  count,
  max = 99,
  srLabel,
  className,
}: {
  count: number;
  max?: number;
  srLabel: string;
  className?: string;
}) {
  if (count <= 0) return null;

  const display = count > max ? `${max}+` : String(count);

  return (
    <span
      className={cn(
        'pointer-events-none absolute -top-1 -right-1 inline-flex min-w-[1.125rem] items-center justify-center',
        'bg-danger rounded-[var(--radius-pill)] px-1 text-[0.6875rem] leading-[1.125rem] font-semibold',
        'text-danger-foreground',
        className
      )}
    >
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
