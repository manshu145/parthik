import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation primitives.
 *
 * Always use these instead of next/link and next/navigation in app code, so
 * links keep the active locale prefix. Using the raw Next helpers would silently
 * drop a Hindi user back to English URLs.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
