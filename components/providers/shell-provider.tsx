'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  EMPTY_CART_SUMMARY,
  NO_LOCATION,
  type CartSummary,
  type SelectedLocation,
} from '@/lib/shell/types';

/**
 * Shell UI state.
 *
 * Holds only PRESENTATION state: which drawer is open, and the current cart and
 * location values the shell displays.
 *
 * ⚠️ It deliberately performs no business logic. Cart totals and serviceability
 * are computed server-side (TASK 008 and TASK 005) and pushed in here; the shell
 * must never derive a total or decide whether an address is serviceable, or that
 * logic would exist in two places.
 *
 * `setLocation` therefore accepts an already-resolved value from the location API
 * rather than computing one.
 */

interface ShellState {
  isCartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  setCartOpen: (open: boolean) => void;

  isLocationOpen: boolean;
  openLocation: () => void;
  closeLocation: () => void;
  setLocationOpen: (open: boolean) => void;

  /** Placeholder until TASK 008 supplies real values. */
  cart: CartSummary;

  /**
   * The chosen delivery location.
   *
   * Seeded server-side from the location cookie so the header renders the right
   * label on first paint (no flash of "Select location"), then updated by the
   * location sheet after the SERVER has resolved serviceability.
   */
  location: SelectedLocation;
  /**
   * Replaces the displayed location.
   *
   * Only ever called with a server-resolved result. The shell must not construct a
   * `SelectedLocation` from client-side guesswork — `isServiceable` is a
   * server-owned fact.
   */
  setLocation: (location: SelectedLocation) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({
  children,
  initialCart = EMPTY_CART_SUMMARY,
  initialLocation = NO_LOCATION,
}: {
  children: ReactNode;
  initialCart?: CartSummary;
  initialLocation?: SelectedLocation;
}) {
  const [isCartOpen, setCartOpen] = useState(false);
  const [isLocationOpen, setLocationOpen] = useState(false);
  const [location, setLocation] = useState<SelectedLocation>(initialLocation);

  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);
  const openLocation = useCallback(() => setLocationOpen(true), []);
  const closeLocation = useCallback(() => setLocationOpen(false), []);

  const value = useMemo<ShellState>(
    () => ({
      isCartOpen,
      openCart,
      closeCart,
      setCartOpen,
      isLocationOpen,
      openLocation,
      closeLocation,
      setLocationOpen,
      cart: initialCart,
      location,
      setLocation,
    }),
    [
      isCartOpen,
      isLocationOpen,
      openCart,
      closeCart,
      openLocation,
      closeLocation,
      initialCart,
      location,
    ]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error('useShell must be used inside <ShellProvider>');
  }
  return context;
}
