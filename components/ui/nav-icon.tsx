import {
  Bell,
  Grid2x2,
  Heart,
  Home,
  LifeBuoy,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  ShoppingCart,
  Tag,
  User,
} from 'lucide-react';
import type { NavIconName } from '@/lib/navigation/nav-config';
import { cn } from '@/lib/utils';

/**
 * Maps the icon names used in the navigation config to components.
 *
 * Keeping this mapping here lets `nav-config.ts` stay a plain data module with no
 * JSX, so it can be imported by tests and server code without pulling in React.
 */
const ICONS: Record<NavIconName, typeof Home> = {
  home: Home,
  grid: Grid2x2,
  tag: Tag,
  cart: ShoppingCart,
  user: User,
  heart: Heart,
  search: Search,
  package: Package,
  bell: Bell,
  shield: ShieldCheck,
  lifebuoy: LifeBuoy,
  mapPin: MapPin,
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  // Decorative: the adjacent text label is the accessible name.
  return <Icon aria-hidden="true" className={cn('size-5 shrink-0', className)} />;
}
