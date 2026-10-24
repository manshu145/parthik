import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard page container.
 *
 * One place decides max width, horizontal gutters and heading rhythm, so pages do
 * not each invent their own spacing (master spec §24: "Do not create random
 * styling page-by-page").
 */
export function PageShell({
  title,
  description,
  children,
  className,
  headerAction,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-4 py-6 md:py-8', className)}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* Exactly one h1 per page, for document outline and SEO. */}
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        </div>
        {headerAction}
      </div>

      {children}
    </div>
  );
}

/**
 * Marks a screen whose UI exists but whose data does not.
 *
 * Being explicit is better than an empty page that looks broken, and better than
 * mock content that could be mistaken for real behaviour.
 */
export function ShellPlaceholderNotice({ label }: { label: string }) {
  return (
    <p
      data-testid="shell-placeholder"
      className="border-border bg-muted/40 text-muted-foreground rounded-[var(--radius-control)] border border-dashed px-4 py-3 text-sm"
    >
      {label}
    </p>
  );
}
