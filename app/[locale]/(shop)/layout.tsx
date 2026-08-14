import type { ReactNode } from 'react';
import { ShopShell } from '@/components/layout/shop-shell';

/**
 * Public commerce layout (docs/ROUTES.md §2).
 *
 * Wraps every public shop route in the customer shell. Route groups exist so each
 * surface gets its own layout and cache posture: this one is publicly cacheable
 * and indexable, unlike `(customer)`.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <ShopShell>{children}</ShopShell>;
}
