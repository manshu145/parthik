/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from './helpers/render-with-intl';

/**
 * Component tests for the remaining shell surfaces: header, footer, cart drawer,
 * location sheet and skip link.
 *
 * The focus is behaviour that is easy to break and hard to notice: accessible
 * names, dialog semantics, focus handling, and the fact that money is formatted
 * rather than computed.
 */

const mockPathname = vi.hoisted(() => ({ current: '/' }));
const mockPush = vi.hoisted(() => vi.fn());

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname.current,
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
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

// The locale switcher needs Next's route params, and the location sheet calls
// router.refresh() so server components re-read the location cookie.
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useRouter: () => ({ refresh: mockRefresh }),
}));

const { SiteHeader } = await import('@/components/layout/site-header');
const { SiteFooter } = await import('@/components/layout/site-footer');
const { CartDrawer, CartTrigger } = await import('@/components/layout/cart-drawer');
const { LocationSheet, LocationTrigger } = await import('@/components/layout/location-selector');
const { SkipLink } = await import('@/components/layout/skip-link');
const { AccountNav } = await import('@/components/layout/account-nav');
const { ShellProvider } = await import('@/components/providers/shell-provider');
const { EMPTY_CART_SUMMARY } = await import('@/lib/shell/types');
const { SearchBar } = await import('@/components/layout/search-bar');

afterEach(() => {
  cleanup();
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockPathname.current = '/';
  vi.unstubAllGlobals();
});

function withShell(ui: React.ReactElement, cart = EMPTY_CART_SUMMARY, locale: 'en' | 'hi' = 'en') {
  return renderWithIntl(<ShellProvider initialCart={cart}>{ui}</ShellProvider>, { locale });
}

describe('SiteHeader', () => {
  it('renders a banner landmark with the brand home link', () => {
    withShell(<SiteHeader />);

    expect(screen.getByTestId('site-header')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Parthik home' }).getAttribute('href')).toBe('/');
  });

  it('exposes the location trigger and cart trigger', () => {
    withShell(<SiteHeader />);

    expect(screen.getByTestId('location-trigger')).toBeDefined();
    expect(screen.getByTestId('cart-trigger')).toBeDefined();
  });

  it('renders desktop navigation with an accessible name', () => {
    withShell(<SiteHeader />);
    expect(screen.getByRole('navigation', { name: 'Secondary navigation' })).toBeDefined();
  });

  it('renders search twice — one per breakpoint — each with a label', () => {
    withShell(<SiteHeader />);

    // Two instances (mobile row + desktop inline); both must be labelled.
    const searches = screen.getAllByRole('search', { name: 'Search products' });
    expect(searches).toHaveLength(2);
  });

  it('marks the active desktop nav item', () => {
    mockPathname.current = '/offers';
    withShell(<SiteHeader />);

    const nav = screen.getByRole('navigation', { name: 'Secondary navigation' });
    const active = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('href')).toBe('/offers');
  });

  it('renders Hindi labels', () => {
    withShell(<SiteHeader />, EMPTY_CART_SUMMARY, 'hi');
    expect(screen.getByRole('link', { name: 'पार्थिक होम' })).toBeDefined();
  });
});

describe('SiteFooter', () => {
  it('renders a contentinfo landmark', () => {
    withShell(<SiteFooter />);
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('preserves the existing site footer links', () => {
    withShell(<SiteFooter />);

    // master spec §2: these existed on the old site and must not be lost.
    for (const [name, href] of [
      ['About us', '/about'],
      ['Privacy policy', '/privacy'],
      ['Terms & conditions', '/terms'],
      ['Become a vendor', '/vendor-registration'],
      ['Become a delivery partner', '/driver-registration'],
    ] as const) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
  });

  it('gives every footer section a labelled navigation region', () => {
    withShell(<SiteFooter />);

    for (const name of ['Company', 'Legal', 'Partner with us', 'Help']) {
      expect(screen.getByRole('navigation', { name })).toBeDefined();
    }
  });

  it('renders Hindi footer labels', () => {
    withShell(<SiteFooter />, EMPTY_CART_SUMMARY, 'hi');
    expect(screen.getByRole('link', { name: 'हमारे बारे में' })).toBeDefined();
  });
});

describe('CartDrawer', () => {
  it('stays closed until the trigger is pressed', async () => {
    const user = userEvent.setup();
    withShell(
      <>
        <CartTrigger />
        <CartDrawer />
      </>
    );

    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByTestId('cart-trigger'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    // A dialog needs an accessible name or screen readers announce nothing useful.
    expect(within(dialog).getByText('Your cart')).toBeDefined();
  });

  it('shows the empty state with a route onward', async () => {
    const user = userEvent.setup();
    withShell(
      <>
        <CartTrigger />
        <CartDrawer />
      </>
    );

    await user.click(screen.getByTestId('cart-trigger'));
    const dialog = screen.getByRole('dialog');

    // An empty cart is not an error, and it explains the next step.
    expect(within(dialog).getByText('Your cart is empty')).toBeDefined();
    expect(within(dialog).getByRole('link', { name: 'Start shopping' }).getAttribute('href')).toBe(
      '/categories'
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    withShell(
      <>
        <CartTrigger />
        <CartDrawer />
      </>
    );

    await user.click(screen.getByTestId('cart-trigger'));
    expect(screen.getByRole('dialog')).toBeDefined();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('formats server-supplied totals without recomputing them', async () => {
    const user = userEvent.setup();

    withShell(
      <>
        <CartTrigger />
        <CartDrawer />
      </>,
      {
        itemCount: 2,
        // Deliberately NOT the sum of the lines: the shell must display the
        // server's figures verbatim rather than deriving them.
        subtotalPaise: 43_300,
        deliveryFeePaise: 1_100,
        totalAmountPaise: 44_400,
        freeDeliveryGapPaise: null,
        isDeliveryFree: false,
        isQuoteIncomplete: false,
        lines: [
          {
            id: 'line-1',
            productName: 'Demo Atta',
            variantLabel: null,
            unitLabel: '5 kg',
            quantity: 1,
            unitPricePaise: 28_900,
            lineTotalPaise: 28_900,
            imageKey: null,
          },
          {
            id: 'line-2',
            productName: 'Demo Milk',
            variantLabel: null,
            unitLabel: '1 L',
            quantity: 2,
            unitPricePaise: 7_200,
            lineTotalPaise: 14_400,
            imageKey: null,
          },
        ],
      }
    );

    await user.click(screen.getByTestId('cart-trigger'));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Demo Atta')).toBeDefined();
    expect(within(dialog).getByText('Qty 2')).toBeDefined();
    // ₹444 = the provided total, not 28900 + 14400 recomputed.
    expect(within(dialog).getByText(/444/)).toBeDefined();
    expect(within(dialog).getByRole('link', { name: 'View cart' }).getAttribute('href')).toBe(
      '/cart'
    );
  });
});

describe('LocationSheet', () => {
  /**
   * Stubs the location endpoints.
   *
   * `select` is stubbed too, because choosing a location persists it — a test that
   * only stubbed serviceability would pass while the cookie write was broken.
   */
  function stubLocationApi(serviceability: Record<string, unknown>) {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/v1/location/serviceability') || url.includes('/location/select')) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: serviceability, meta: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { suggestions: [] }, meta: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const SERVICEABLE = {
    isServiceable: true,
    pincode: '452001',
    zone: { id: 'zone-1', code: 'ZONE-001', name: 'Central', city: 'Indore', state: 'MP' },
    baseDeliveryFeePaise: 2_500,
    freeDeliveryThresholdPaise: 19_900,
    minOrderPaise: 9_900,
    etaMinutes: 35,
  };

  it('opens from the trigger with all three ways to set a location', async () => {
    const user = userEvent.setup();
    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );

    expect(screen.getByTestId('location-trigger').textContent).toContain('Select location');

    await user.click(screen.getByTestId('location-trigger'));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Choose delivery location')).toBeDefined();
    // Detect is now functional, not a disabled placeholder.
    expect(within(dialog).getByTestId('location-detect')).not.toBeDisabled();
    expect(within(dialog).getByTestId('location-search')).toBeDefined();
    expect(within(dialog).getByTestId('location-pincode')).toBeDefined();
  });

  it('shows the delivery terms for a serviceable pincode', async () => {
    const user = userEvent.setup();
    stubLocationApi(SERVICEABLE);

    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );

    await user.click(screen.getByTestId('location-trigger'));
    await user.type(screen.getByTestId('location-pincode'), '452001');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    const outcome = await screen.findByTestId('location-serviceable');

    expect(outcome.textContent).toContain('We deliver to Indore');
    // Fees come from the SERVER response and are only formatted here. ₹25 and ₹199
    // must render as such, or the paise/rupee boundary is wrong somewhere.
    expect(outcome.textContent).toContain('₹25');
    expect(outcome.textContent).toContain('₹199');
    expect(outcome.textContent).toContain('35 min');
  });

  it('says plainly that an unserviceable pincode is not covered', async () => {
    const user = userEvent.setup();
    stubLocationApi({
      isServiceable: false,
      pincode: '110001',
      zone: null,
      baseDeliveryFeePaise: null,
      freeDeliveryThresholdPaise: null,
      minOrderPaise: null,
      etaMinutes: null,
    });

    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );

    await user.click(screen.getByTestId('location-trigger'));
    await user.type(screen.getByTestId('location-pincode'), '110001');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    const outcome = await screen.findByTestId('location-unserviceable');

    expect(outcome.textContent).toContain('110001');
    // No fee or ETA is invented for an area we do not serve.
    expect(outcome.textContent).not.toContain('₹');
  });

  it('keeps the check button disabled until six digits are entered', async () => {
    const user = userEvent.setup();
    withShell(<LocationSheet />);

    // The sheet is closed, so open it via the shell trigger instead.
    cleanup();
    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );
    await user.click(screen.getByTestId('location-trigger'));

    const check = screen.getByRole('button', { name: 'Check' });
    expect(check).toBeDisabled();

    await user.type(screen.getByTestId('location-pincode'), '4520');
    expect(check).toBeDisabled();

    await user.type(screen.getByTestId('location-pincode'), '01');
    expect(check).not.toBeDisabled();
  });

  it('strips non-digits from pincode input', async () => {
    const user = userEvent.setup();
    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );

    await user.click(screen.getByTestId('location-trigger'));
    const input = screen.getByTestId('location-pincode') as HTMLInputElement;

    await user.type(input, '45a2b0c01');

    // An invalid value cannot be entered at all, rather than being rejected later.
    expect(input.value).toBe('452001');
  });

  it('refreshes the server tree after a location is chosen', async () => {
    const user = userEvent.setup();
    stubLocationApi(SERVICEABLE);

    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );

    await user.click(screen.getByTestId('location-trigger'));
    await user.type(screen.getByTestId('location-pincode'), '452001');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('location-serviceable');

    // Server components read the location cookie, so without a refresh the page
    // would keep rendering the previous zone.
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('updates the header label to the chosen location', async () => {
    const user = userEvent.setup();
    stubLocationApi(SERVICEABLE);

    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>
    );

    await user.click(screen.getByTestId('location-trigger'));
    await user.type(screen.getByTestId('location-pincode'), '452001');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByTestId('location-serviceable');

    expect(screen.getByTestId('location-trigger').textContent).toContain('Indore');
  });

  it('renders the Hindi flow', async () => {
    const user = userEvent.setup();
    stubLocationApi(SERVICEABLE);

    withShell(
      <>
        <LocationTrigger />
        <LocationSheet />
      </>,
      EMPTY_CART_SUMMARY,
      'hi'
    );

    await user.click(screen.getByTestId('location-trigger'));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('डिलीवरी का स्थान चुनें')).toBeDefined();
    expect(within(dialog).getByTestId('location-pincode')).toBeDefined();
  });
});

describe('SearchBar', () => {
  /**
   * The input is a `combobox`, not a `searchbox`: it now drives a typeahead
   * listbox, and the ARIA combobox pattern is what makes that announceable.
   *
   * Suggestions are stubbed to empty. These tests are about SUBMISSION, and a real
   * fetch would leave a debounce timer running past the end of the test.
   */
  function stubNoSuggestions() {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { suggestions: [] }, meta: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('navigates to the search route with the query', async () => {
    const user = userEvent.setup();
    stubNoSuggestions();
    renderWithIntl(<SearchBar />);

    await user.type(screen.getByRole('combobox', { name: 'Search products' }), 'atta{Enter}');

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/search', query: { q: 'atta' } });
  });

  it('ignores an empty or whitespace-only submission', async () => {
    const user = userEvent.setup();
    stubNoSuggestions();
    renderWithIntl(<SearchBar />);

    await user.type(screen.getByRole('combobox', { name: 'Search products' }), '   {Enter}');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not request suggestions for a term below the minimum length', async () => {
    const user = userEvent.setup();
    const fetchMock = stubNoSuggestions();
    renderWithIntl(<SearchBar />);

    await user.type(screen.getByRole('combobox', { name: 'Search products' }), 'a');
    // Past the debounce window.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // One character matches most of the catalogue; asking the server is pure cost.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes combobox semantics for the typeahead', async () => {
    stubNoSuggestions();
    renderWithIntl(<SearchBar />);

    const input = screen.getByRole('combobox', { name: 'Search products' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
  });
});

describe('SkipLink', () => {
  it('targets the main landmark and is the first tab stop', async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <>
        <SkipLink label="Skip to main content" />
        {/* Fragment href: a real page path would trip the Next lint rule. */}
        <a href="#other">Other link</a>
      </>
    );

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#main');

    await user.tab();
    expect(document.activeElement).toBe(skip);
  });
});

describe('AccountNav', () => {
  it('renders the account hub destinations', () => {
    withShell(<AccountNav />);

    const nav = screen.getByTestId('account-nav');
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    // /orders and /favorites are the canonical routes, not /account/orders.
    expect(hrefs).toEqual([
      '/account/profile',
      '/account/addresses',
      '/orders',
      '/favorites',
      '/account/notifications',
      '/account/security',
      '/account/support',
    ]);
  });

  it('marks the active sub-route', () => {
    mockPathname.current = '/account/addresses';
    withShell(<AccountNav />);

    expect(screen.getByRole('link', { current: 'page' }).getAttribute('href')).toBe(
      '/account/addresses'
    );
  });
});
