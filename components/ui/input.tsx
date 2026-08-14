import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Input primitive (shadcn/ui foundation).
 *
 * `h-11` is 44px, the minimum tap target from master spec §24/§26. `text-base` on
 * mobile is not cosmetic: iOS Safari zooms the viewport when a focused input has a
 * font size below 16px, which is disorienting mid-form.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'border-border bg-background flex h-11 w-full rounded-[var(--radius-control)] border px-3 py-2',
        'text-base md:text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-danger',
        className
      )}
      {...props}
    />
  );
}
