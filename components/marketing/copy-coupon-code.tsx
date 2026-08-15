'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A coupon code that copies itself.
 *
 * The only interactive part of an offer card, so it is the only part that ships
 * JavaScript — the rest of `/offers` stays a server-rendered list.
 *
 * DEGRADES HONESTLY: when the clipboard is unavailable (older browser, insecure
 * context, permission refused) the code is still displayed and selectable, and the
 * button simply reports nothing rather than claiming a copy that did not happen.
 */
export function CopyCouponCode({
  code,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [isCopied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      // Long enough to be noticed, short enough that the button is ready again
      // before a customer wants to copy a different code.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing to report: the code is on screen and can be selected by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      data-testid="offer-code"
      aria-label={`${copyLabel} ${code}`}
      className="border-border hover:bg-muted flex min-h-[var(--size-tap-target)] shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-dashed px-3 font-mono text-sm font-semibold tracking-wider focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]"
    >
      {code}
      {isCopied ? (
        <Check aria-hidden="true" className="text-success size-4" />
      ) : (
        <Copy aria-hidden="true" className="text-muted-foreground size-4" />
      )}
      {/* Announced rather than only shown, so the confirmation is not visual-only. */}
      <span role="status" className="sr-only">
        {isCopied ? copiedLabel : ''}
      </span>
    </button>
  );
}
