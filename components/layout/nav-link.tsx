'use client';

import { usePathname } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { isNavItemActive, type NavItem } from '@/lib/navigation/nav-config';
import { cn } from '@/lib/utils';

/**
 * Locale-aware navigation link with active state.
 *
 * Uses `Link`/`usePathname` from `@/i18n/navigation` rather than `next/link`, so
 * the active locale prefix is preserved — the raw Next helpers would silently drop
 * a Hindi user back to English URLs.
 *
 * Active state is communicated by `aria-current`, not colour alone, because colour
 * must never be the only state indicator (master spec §26).
 */
export function NavLink({
  item,
  label,
  className,
  activeClassName,
  inactiveClassName,
  children,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  children?: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = isNavItemActive(pathname, item);

  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      data-active={isActive ? 'true' : 'false'}
      data-nav-id={item.id}
      onClick={onNavigate}
      className={cn(
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
        className,
        isActive ? activeClassName : inactiveClassName
      )}
    >
      {children ?? label}
    </Link>
  );
}
