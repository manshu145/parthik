/**
 * View models for catalog UI.
 *
 * WHY THESE EXIST: the ESLint import boundary forbids `components/**` from
 * importing `@/modules/*`, so presentational components cannot reference
 * `LocalisedProduct` directly. These are the narrow, structural shapes a component
 * actually needs.
 *
 * The module types are structurally assignable to them, so pages pass repository
 * results straight through — no mapping boilerplate — while the components stay
 * decoupled from the data layer and trivially testable with literals.
 *
 * They are intentionally SMALLER than the module types. A product card has no
 * business receiving `costPaise`.
 */

export interface ProductCardView {
  slug: string;
  name: string;
  shortDescription?: string | null;
  unitLabel: string | null;
  pricePaise: number;
  mrpPaise: number;
  /** Null when there is no real discount, so "0% off" cannot render. */
  discountPercent: number | null;
  inStock: boolean;
  primaryImageKey: string | null;
  primaryImageAlt: string | null;
}

export interface CategoryCardView {
  slug: string;
  name: string;
  description?: string | null;
  imageKey: string | null;
  iconKey: string | null;
}

/** Copy for a product card. Passed in translated, never looked up in the component. */
export interface ProductCardLabels {
  outOfStock: string;
  /**
   * Raw ICU message containing a literal `{percent}` placeholder, e.g.
   * `"{percent}% off"`.
   *
   * Supplied via next-intl's `t.raw()` and interpolated per card, because the
   * percentage differs per product while the component must stay presentational
   * and cannot look up translations itself.
   */
  discountBadgeTemplate: string;
  mrpLabel: string;
  imagePlaceholder: string;
}

export interface CatalogSortOption {
  /** The `sort` value, e.g. `pricePaise:asc`. */
  value: string;
  label: string;
  isActive: boolean;
  /** Href preserving every other search param. */
  href: string;
}
