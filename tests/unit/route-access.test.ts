import { describe, expect, it } from 'vitest';
import {
  classifySurface,
  homePathForSurface,
  isNoindexPath,
  isSafeRedirectTarget,
  requiresSession,
  stripLocalePrefix,
} from '@/lib/http/route-access';

/**
 * Coarse route classification used by middleware (docs/ROUTES.md §10).
 *
 * These rules must behave identically with and without a locale prefix — a Hindi
 * user reaching /hi/admin must be gated exactly as an English user reaching
 * /admin. Getting this wrong would be an authorization hole that only appears in
 * one language, which is precisely the kind of bug that survives manual testing.
 */

describe('locale prefix handling', () => {
  it('strips a Hindi prefix', () => {
    expect(stripLocalePrefix('/hi/vendor/orders')).toBe('/vendor/orders');
    expect(stripLocalePrefix('/hi')).toBe('/');
    expect(stripLocalePrefix('/hi/')).toBe('/');
  });

  it('leaves unprefixed English paths untouched', () => {
    expect(stripLocalePrefix('/vendor/orders')).toBe('/vendor/orders');
    expect(stripLocalePrefix('/')).toBe('/');
  });

  it('does not strip a path that merely starts with locale letters', () => {
    expect(stripLocalePrefix('/history')).toBe('/history');
    expect(stripLocalePrefix('/enquiry')).toBe('/enquiry');
  });
});

describe('surface classification', () => {
  it.each([
    ['/', 'public'],
    ['/products/atta', 'public'],
    ['/category/groceries', 'public'],
    ['/offers', 'public'],
    ['/account', 'customer'],
    ['/account/addresses', 'customer'],
    ['/checkout', 'customer'],
    ['/orders/abc', 'customer'],
    ['/favorites', 'customer'],
    ['/vendor', 'vendor'],
    ['/vendor/products', 'vendor'],
    ['/driver/active', 'driver'],
    ['/admin/orders', 'admin'],
    ['/api/v1/health', 'api'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classifySurface(path)).toBe(expected);
  });

  it('classifies Hindi paths identically', () => {
    expect(classifySurface('/hi/admin/orders')).toBe('admin');
    expect(classifySurface('/hi/checkout')).toBe('customer');
    expect(classifySurface('/hi/')).toBe('public');
  });

  it('does not treat a lookalike public path as protected', () => {
    // /vendor-registration is a PUBLIC funnel page and must not require a session.
    expect(classifySurface('/vendor-registration')).toBe('public');
    expect(classifySurface('/driver-registration')).toBe('public');
    expect(requiresSession('/vendor-registration')).toBe(false);
  });
});

describe('session requirement', () => {
  it('requires a session on every private surface, in both locales', () => {
    for (const path of ['/account', '/checkout', '/orders', '/vendor', '/driver', '/admin']) {
      expect(requiresSession(path), path).toBe(true);
      expect(requiresSession(`/hi${path}`), `/hi${path}`).toBe(true);
    }
  });

  it('does not gate public pages', () => {
    for (const path of ['/', '/products/x', '/offers', '/about']) {
      expect(requiresSession(path), path).toBe(false);
    }
  });

  it('leaves API routes to authorize themselves', () => {
    // A JSON 401 is the correct response there, not a redirect to /login.
    expect(requiresSession('/api/v1/orders')).toBe(false);
  });
});

describe('indexability', () => {
  it('marks every private surface noindex', () => {
    for (const path of [
      '/account',
      '/checkout',
      '/orders',
      '/vendor',
      '/driver',
      '/admin',
      '/login',
    ]) {
      expect(isNoindexPath(path), path).toBe(true);
      expect(isNoindexPath(`/hi${path}`), `/hi${path}`).toBe(true);
    }
  });

  it('marks search noindex as thin/duplicative content', () => {
    expect(isNoindexPath('/search')).toBe(true);
  });

  it('leaves public commerce pages indexable', () => {
    expect(isNoindexPath('/')).toBe(false);
    expect(isNoindexPath('/products/atta')).toBe(false);
    expect(isNoindexPath('/hi/products/atta')).toBe(false);
  });
});

describe('redirect target safety', () => {
  it('accepts internal paths', () => {
    expect(isSafeRedirectTarget('/checkout')).toBe(true);
    expect(isSafeRedirectTarget('/orders/1?tab=items')).toBe(true);
  });

  it('rejects open-redirect attempts', () => {
    expect(isSafeRedirectTarget('//evil.example.com')).toBe(false);
    expect(isSafeRedirectTarget('https://evil.example.com')).toBe(false);
    expect(isSafeRedirectTarget('/\\evil.example.com')).toBe(false);
    expect(isSafeRedirectTarget('javascript:alert(1)')).toBe(false);
  });
});

describe('surface home paths', () => {
  it('sends each role to its own surface', () => {
    expect(homePathForSurface('vendor')).toBe('/vendor');
    expect(homePathForSurface('driver')).toBe('/driver');
    expect(homePathForSurface('admin')).toBe('/admin');
    expect(homePathForSurface('customer')).toBe('/');
  });
});
