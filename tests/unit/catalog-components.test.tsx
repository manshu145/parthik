/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ProductCardLabels, ProductCardView } from '@/lib/catalog/view';

/**
 * Catalog component tests.
 *
 * The theme throughout: these components FORMAT, they never COMPUTE. Prices,
 * discounts and stock are server-owned, so the tests deliberately feed values that
 * are internally inconsistent to prove the component renders what it was given
 * rather than recalculating.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { ProductCard } = await import('@/components/catalog/product-card');
const { ProductGrid, ProductGridSkeleton } = await import('@/components/catalog/product-grid');
const { CategoryCard, CategoryGrid } = await import('@/components/catalog/category-card');
const { ProductPrice } = await import('@/components/catalog/product-price');

afterEach(() => {
  cleanup();
});

const LABELS: ProductCardLabels = {
  outOfStock: 'Out of stock',
  discountBadgeTemplate: '{percent}% off',
  mrpLabel: 'Original price',
  imagePlaceholder: 'No image yet',
};

function product(overrides: Partial<ProductCardView> = {}): ProductCardView {
  return {
    slug: 'demo-atta-5kg',
    name: 'Demo Whole Wheat Atta',
    unitLabel: '5 kg',
    pricePaise: 28_900,
    mrpPaise: 32_500,
    discountPercent: 11,
    inStock: true,
    primaryImageKey: null,
    primaryImageAlt: null,
    ...overrides,
  };
}

describe('ProductPrice', () => {
  it('formats paise as rupees', () => {
    render(
      <ProductPrice
        pricePaise={28_900}
        mrpPaise={32_500}
        discountPercent={11}
        locale="en"
        mrpLabel="Original price"
      />
    );

    expect(screen.getByTestId('product-price').textContent).toBe('₹289');
    expect(screen.getByTestId('product-mrp').textContent).toBe('₹325');
  });

  it('shows no struck-through MRP when there is no discount', () => {
    // A struck-through price equal to the selling price is a fake discount.
    render(
      <ProductPrice
        pricePaise={7_200}
        mrpPaise={7_200}
        discountPercent={null}
        locale="en"
        mrpLabel="Original price"
      />
    );

    expect(screen.queryByTestId('product-mrp')).toBeNull();
  });

  it('does not strike through when discountPercent is null even if MRP is higher', () => {
    // The server decides whether a discount is advertisable; the component obeys.
    render(
      <ProductPrice
        pricePaise={100}
        mrpPaise={999}
        discountPercent={null}
        locale="en"
        mrpLabel="Original price"
      />
    );

    expect(screen.queryByTestId('product-mrp')).toBeNull();
  });

  it('formats in the Hindi locale', () => {
    render(
      <ProductPrice
        pricePaise={28_900}
        mrpPaise={28_900}
        discountPercent={null}
        locale="hi"
        mrpLabel="मूल कीमत"
      />
    );

    expect(screen.getByTestId('product-price').textContent).toContain('₹');
  });

  it('renders paise when the amount is not a whole rupee', () => {
    render(
      <ProductPrice
        pricePaise={28_950}
        mrpPaise={28_950}
        discountPercent={null}
        locale="en"
        mrpLabel="x"
      />
    );

    expect(screen.getByTestId('product-price').textContent).toBe('₹289.50');
  });
});

describe('ProductCard', () => {
  it('links to the product page by slug', () => {
    render(<ProductCard product={product()} locale="en" labels={LABELS} />);

    expect(screen.getByTestId('product-card').getAttribute('href')).toBe('/products/demo-atta-5kg');
  });

  it('renders the name and unit label', () => {
    render(<ProductCard product={product()} locale="en" labels={LABELS} />);

    const card = screen.getByTestId('product-card');
    expect(within(card).getByText('Demo Whole Wheat Atta')).toBeDefined();
    expect(within(card).getByText('5 kg')).toBeDefined();
  });

  it('interpolates the discount percentage into the badge', () => {
    render(<ProductCard product={product({ discountPercent: 25 })} locale="en" labels={LABELS} />);

    expect(screen.getByTestId('product-discount').textContent).toBe('25% off');
  });

  it('shows NO discount badge when there is no discount', () => {
    render(
      <ProductCard product={product({ discountPercent: null })} locale="en" labels={LABELS} />
    );

    expect(screen.queryByTestId('product-discount')).toBeNull();
  });

  it('marks an out-of-stock product on the card itself', () => {
    // Discovered while browsing, not at checkout.
    render(<ProductCard product={product({ inStock: false })} locale="en" labels={LABELS} />);

    const badge = screen.getByTestId('product-out-of-stock');
    expect(badge.textContent).toContain('Out of stock');
  });

  it('shows no stock overlay for an in-stock product', () => {
    render(<ProductCard product={product({ inStock: true })} locale="en" labels={LABELS} />);

    expect(screen.queryByTestId('product-out-of-stock')).toBeNull();
  });

  it('FORMATS the price it is given rather than deriving one', () => {
    // Deliberately inconsistent input: 999 paise with a claimed 50% discount off
    // 32500. If the card recomputed anything, these numbers would not survive.
    render(
      <ProductCard
        product={product({ pricePaise: 999, mrpPaise: 32_500, discountPercent: 50 })}
        locale="en"
        labels={LABELS}
      />
    );

    expect(screen.getByTestId('product-price').textContent).toBe('₹9.99');
    expect(screen.getByTestId('product-discount').textContent).toBe('50% off');
  });

  it('renders an image placeholder when no image is configured', () => {
    render(<ProductCard product={product()} locale="en" labels={LABELS} />);

    expect(screen.getByTestId('product-image-placeholder')).toBeDefined();
  });

  it('has exactly one interactive element, so keyboard users get one tab stop', () => {
    render(<ProductCard product={product()} locale="en" labels={LABELS} />);

    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('omits the unit label when absent instead of rendering an empty line', () => {
    render(<ProductCard product={product({ unitLabel: null })} locale="en" labels={LABELS} />);

    expect(screen.queryByText('5 kg')).toBeNull();
  });
});

describe('ProductGrid', () => {
  it('renders one card per product', () => {
    render(
      <ProductGrid
        products={[product(), product({ slug: 'b', name: 'B' })]}
        locale="en"
        labels={LABELS}
      />
    );

    expect(screen.getAllByTestId('product-card')).toHaveLength(2);
  });

  it('renders an empty list rather than inventing an empty state', () => {
    // The caller owns the empty state, because it has the context to explain why.
    render(<ProductGrid products={[]} locale="en" labels={LABELS} />);

    expect(screen.getByTestId('product-grid').children).toHaveLength(0);
  });

  it('renders a skeleton matching the grid shape', () => {
    render(<ProductGridSkeleton count={4} />);

    expect(screen.getByTestId('product-grid-skeleton').children).toHaveLength(4);
  });
});

describe('CategoryCard', () => {
  it('links to the category page by slug', () => {
    render(
      <CategoryCard
        category={{ slug: 'staples', name: 'Staples', imageKey: null, iconKey: null }}
        placeholderLabel="No image yet"
      />
    );

    expect(screen.getByTestId('category-card').getAttribute('href')).toBe('/category/staples');
  });

  it('renders a grid of categories', () => {
    render(
      <CategoryGrid
        categories={[
          { slug: 'a', name: 'A', imageKey: null, iconKey: null },
          { slug: 'b', name: 'B', imageKey: null, iconKey: null },
        ]}
        placeholderLabel="No image yet"
      />
    );

    expect(screen.getAllByTestId('category-card')).toHaveLength(2);
  });

  it('falls back to the icon key when no image key exists', () => {
    render(
      <CategoryCard
        category={{ slug: 'a', name: 'A', imageKey: null, iconKey: 'icons/a.svg' }}
        placeholderLabel="No image yet"
      />
    );

    // Delivery is unconfigured, so it still resolves to the placeholder — the point
    // is that it does not crash on a key-only fallback.
    expect(screen.getByTestId('product-image-placeholder')).toBeDefined();
  });
});
