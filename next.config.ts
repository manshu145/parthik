import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on type errors. TASK 001 requires a green build
  // to be meaningful, so this must never be silently skipped.
  //
  // Note: Next.js 16 removed `next lint` and the `eslint` config key, so linting
  // is a separate pipeline step (`pnpm lint`) rather than part of the build.
  typescript: { ignoreBuildErrors: false },

  // Do not leak framework details in response headers.
  poweredByHeader: false,

  // Images: the default Next optimizer is a poor fit on Workers. The final
  // loader is decision D-07a (Cloudflare Images vs custom loader), so for the
  // foundation we only declare permitted remote hosts and leave optimization
  // at its default. See docs/ARCHITECTURE.md §9.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleapis.com' },
      { protocol: 'https', hostname: '*.gstatic.com' },
    ],
  },

  // Security headers are applied in middleware.ts so that they cover every
  // response (including route handlers) from a single place.
};

export default withNextIntl(nextConfig);
