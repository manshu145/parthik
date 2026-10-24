import { Link } from '@/i18n/navigation';
import type { CategoryCardView } from '@/lib/catalog/view';
import { cn } from '@/lib/utils';
import { ProductImage } from './product-image';

/**
 * Category tile.
 *
 * Same placeholder story as products: category `image_key`/`icon_key` are unseeded
 * and image delivery is unconfigured until D-07a, so this shows a neutral
 * placeholder rather than a broken image.
 */
export function CategoryCard({
  category,
  placeholderLabel,
  className,
}: {
  category: CategoryCardView;
  placeholderLabel: string;
  className?: string;
}) {
  return (
    <Link
      href={`/category/${category.slug}`}
      data-testid="category-card"
      className={cn(
        'border-border bg-card flex flex-col gap-2 rounded-[var(--radius-card)] border p-2',
        'transition-colors hover:border-[var(--color-primary)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
        className
      )}
    >
      <ProductImage
        storageKey={category.imageKey ?? category.iconKey}
        alt={null}
        placeholderLabel={placeholderLabel}
        sizes="(min-width: 1024px) 16vw, 30vw"
      />
      <span className="line-clamp-2 text-center text-sm leading-snug font-medium">
        {category.name}
      </span>
    </Link>
  );
}

export function CategoryGrid({
  categories,
  placeholderLabel,
  className,
}: {
  categories: CategoryCardView[];
  placeholderLabel: string;
  className?: string;
}) {
  return (
    <ul
      data-testid="category-grid"
      className={cn('grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6', className)}
    >
      {categories.map((category) => (
        <li key={category.slug} className="flex">
          <CategoryCard
            category={category}
            placeholderLabel={placeholderLabel}
            className="w-full"
          />
        </li>
      ))}
    </ul>
  );
}
