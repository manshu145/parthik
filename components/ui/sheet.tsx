'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sheet — a side/bottom drawer built on Radix Dialog.
 *
 * Radix is used rather than a hand-rolled modal because it handles the things
 * that are easy to get wrong and hard to notice: focus trapping, focus restore on
 * close, `aria-modal`, Escape handling, scroll locking and outside-click
 * dismissal (master spec §26 accessible dialogs).
 *
 * Used by the cart drawer and the location selector.
 */

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'bg-foreground/40 fixed inset-0 backdrop-blur-[2px]',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
      className
    )}
    style={{ zIndex: 'var(--z-drawer)' }}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

type SheetSide = 'right' | 'bottom' | 'left';

const SIDE_CLASSES: Record<SheetSide, string> = {
  right:
    'inset-y-0 right-0 h-full w-full max-w-sm border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left: 'inset-y-0 left-0 h-full w-full max-w-sm border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  // Bottom sheets are the natural mobile pattern; capped so they never cover the
  // whole viewport and leave the user with no visible way out.
  bottom:
    'inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-[var(--radius-card)] border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
};

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  side?: SheetSide;
  /** Accessible title. Required — a dialog without a name is unusable by screen readers. */
  title: string;
  description?: string;
  closeLabel: string;
  /** Renders the title visually. When false it stays screen-reader only. */
  showTitle?: boolean;
  footer?: React.ReactNode;
}

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      className,
      children,
      side = 'right',
      title,
      description,
      closeLabel,
      showTitle = true,
      footer,
      ...props
    },
    ref
  ) => (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'bg-background fixed flex flex-col shadow-[var(--shadow-raised)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out duration-[var(--duration-base)]',
          SIDE_CLASSES[side],
          className
        )}
        style={{ zIndex: 'var(--z-drawer)' }}
        {...props}
      >
        <header className="border-border flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <DialogPrimitive.Title
              className={cn('text-base font-semibold', !showTitle && 'sr-only')}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted-foreground mt-1 text-sm">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>

          <DialogPrimitive.Close
            className={cn(
              'inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)]',
              'text-muted-foreground hover:bg-muted transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
            )}
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        </header>

        {/* Scrolls independently of the header and footer, and respects the home
            indicator on iOS via safe-area padding. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>

        {footer ? (
          <footer className="border-border border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
);
SheetContent.displayName = 'SheetContent';

export { Sheet, SheetTrigger, SheetClose, SheetContent };
