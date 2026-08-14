/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from './helpers/render-with-intl';

/**
 * Component tests for the mobile bottom navigation.
 *
 * `@/i18n/navigation` is mocked because next-intl's navigation helpers need a
 * Next.js router context that does not exist in a unit test. The mock is
 * deliberately thin — it renders a real anchor and reports a controllable
 * pathname, so active-state and accessibility behaviour are genuinely exercised
 * rather than stubbed away.
 */

const mockPathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

const { BottomNav } = await import('@/components/layout/bottom-nav');
const { ShellProvider } = await import('@/components/providers/shell-provider');
const { EMPTY_CART_SUMMARY } = await import('@/lib/shell/types');

function renderNav({ pathname = '/', locale = 'en' as 'en' | 'hi', itemCount = 0 } = {}) {
  mockPathname.current = pathname;

  return renderWithIntl(
    <ShellProvider initialCart={{ ...EMPTY_CART_SUMMARY, itemCount }}>
      <BottomNav />
    </ShellProvider>,
    { locale }
  );
}

beforeEach(() => {
  mockPathname.current = '/';
});

afterEach(() => {
  cleanup();
});

describe('BottomNav — structure', () => {
  it('renders a named navigation landmark', () => {
    renderNav();
    // A nav without an accessible name is just an unlabelled region.
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeDefined();
  });

  it('renders exactly five links', () => {
    renderNav();
    const nav = screen.getByTestId('bottom-nav');
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
  });

  it('renders the five specified destinations in order', () => {
    renderNav();
    const nav = screen.getByTestId('bottom-nav');
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    expect(hrefs).toEqual(['/', '/categories', '/offers', '/cart', '/account']);
  });

  it('uses a list so assistive tech announces the item count', () => {
    renderNav();
    const nav = screen.getByTestId('bottom-nav');
    expect(within(nav).getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('BottomNav — active state', () => {
  it('marks the current route with aria-current, not colour alone', () => {
    renderNav({ pathname: '/offers' });

    const active = screen.getByRole('link', { current: 'page' });
    expect(active.getAttribute('href')).toBe('/offers');
  });

  it('marks exactly one item active', () => {
    renderNav({ pathname: '/categories' });

    const nav = screen.getByTestId('bottom-nav');
    const activeLinks = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(activeLinks).toHaveLength(1);
  });

  it('keeps Categories active on a category detail route', () => {
    renderNav({ pathname: '/category/fruits-vegetables' });

    const active = screen.getByRole('link', { current: 'page' });
    expect(active.getAttribute('data-nav-id')).toBe('categories');
  });

  it('keeps Account active on an order detail route', () => {
    renderNav({ pathname: '/orders/PK-2026-000123' });

    const active = screen.getByRole('link', { current: 'page' });
    expect(active.getAttribute('data-nav-id')).toBe('account');
  });

  it('marks nothing active on an unrelated route', () => {
    renderNav({ pathname: '/about' });

    const nav = screen.getByTestId('bottom-nav');
    const activeLinks = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(activeLinks).toHaveLength(0);
  });
});

describe('BottomNav — cart badge', () => {
  it('shows no badge when the cart is empty', () => {
    renderNav({ itemCount: 0 });
    expect(screen.queryByText('Cart is empty')).toBeNull();
  });

  it('announces the item count to assistive tech', () => {
    renderNav({ itemCount: 3 });
    // The visible "3" is aria-hidden; this is the accessible announcement.
    expect(screen.getByText('3 items in cart')).toBeDefined();
  });

  it('uses the singular form for one item', () => {
    renderNav({ itemCount: 1 });
    expect(screen.getByText('1 item in cart')).toBeDefined();
  });

  it('caps the displayed number but announces the real one', () => {
    renderNav({ itemCount: 150 });

    expect(screen.getByText('99+')).toBeDefined();
    expect(screen.getByText('150 items in cart')).toBeDefined();
  });
});

describe('BottomNav — Hindi', () => {
  it('renders Devanagari labels', () => {
    renderNav({ locale: 'hi' });

    expect(screen.getByRole('navigation', { name: 'मुख्य नेविगेशन' })).toBeDefined();
    expect(screen.getAllByText('होम').length).toBeGreaterThan(0);
    expect(screen.getAllByText('श्रेणियाँ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('कार्ट').length).toBeGreaterThan(0);
  });

  it('keeps hrefs locale-free so the Link helper adds the prefix', () => {
    renderNav({ locale: 'hi' });

    const nav = screen.getByTestId('bottom-nav');
    for (const link of within(nav).getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/^\/hi/);
    }
  });

  it('pluralises the cart count in Hindi', () => {
    renderNav({ locale: 'hi', itemCount: 2 });
    expect(screen.getByText('कार्ट में 2 आइटम')).toBeDefined();
  });
});

describe('BottomNav — keyboard access', () => {
  it('reaches every item by Tab in DOM order', async () => {
    const user = userEvent.setup();
    renderNav();

    const nav = screen.getByTestId('bottom-nav');
    const links = within(nav).getAllByRole('link');

    for (const link of links) {
      await user.tab();
      expect(document.activeElement).toBe(link);
    }
  });
});
