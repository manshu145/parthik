import { formatPaise, paise } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Price display.
 *
 * The MRP is shown struck through ONLY when there is a real discount. Rendering a
 * struck-through price equal to the selling price is the kind of fake-discount
 * pattern that erodes trust and attracts regulatory attention.
 *
 * Formatting only — this never computes a price. Amounts arrive as integer paise
 * from the server (docs/API_SPEC.md §1.2).
 */
export function ProductPrice({
  pricePaise,
  mrpPaise,
  discountPercent,
  locale,
  mrpLabel,
  className,
  size = 'md',
}: {
  pricePaise: number;
  mrpPaise: number;
  discountPercent: number | null;
  locale: 'en' | 'hi';
  /** Accessible label for the struck-through original price. */
  mrpLabel: string;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const hasDiscount = discountPercent !== null && mrpPaise > pricePaise;

  return (
    <span className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span
        className={cn('font-semibold', size === 'lg' ? 'text-xl' : 'text-sm')}
        data-testid="product-price"
      >
        {formatPaise(paise(pricePaise), locale)}
      </span>

      {hasDiscount && (
        <>
          <span className="sr-only">{mrpLabel}</span>
          <s
            className={cn('text-muted-foreground', size === 'lg' ? 'text-sm' : 'text-xs')}
            data-testid="product-mrp"
          >
            {formatPaise(paise(mrpPaise), locale)}
          </s>
        </>
      )}
    </span>
  );
}
