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

/**
 * Static label badge — discount percentages, stock states, statuses.
 *
 * Separate from `CountBadge`, which is absolutely positioned and carries a
 * screen-reader label for a numeric count. This one is inline and renders its own
 * text, so the text itself is the accessible name.
 */
const BADGE_VARIANTS = {
  neutral: 'bg-muted text-foreground',
  success: 'bg-success text-success-foreground',
  danger: 'bg-danger text-danger-foreground',
  warning: 'bg-warning text-warning-foreground',
  primary: 'bg-primary text-primary-foreground',
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

export function Badge({
  variant = 'neutral',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5',
        'text-[0.6875rem] leading-tight font-semibold',
        BADGE_VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
