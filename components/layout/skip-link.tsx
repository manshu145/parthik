/**
 * Skip-to-content link (master spec §26 keyboard navigation).
 *
 * Visually hidden until focused, then pinned to the top of the viewport. Without
 * it, a keyboard or screen-reader user has to tab through the entire header —
 * location, search and every nav item — on every page load.
 *
 * Deliberately the first focusable element in the DOM.
 */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href="#main"
      data-testid="skip-link"
      className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:inline-flex focus:min-h-[var(--size-tap-target)] focus:items-center focus:rounded-[var(--radius-control)] focus:px-4 focus:text-sm focus:font-medium focus:outline-2 focus:outline-offset-2 focus:outline-[var(--color-ring)]"
    >
      {label}
    </a>
  );
}
