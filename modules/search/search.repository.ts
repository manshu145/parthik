import { sql, type SQL } from 'drizzle-orm';
import { defaultLocale, type Locale } from '@/i18n/routing';
import { resolveLimit, type RepositoryContext } from '@/lib/db/repository';
import type {
  CategorySearchHit,
  ProductSearchQuery,
  ProductSearchResult,
  SearchProvider,
  SearchSuggestion,
} from './search.types';

/**
 * PostgreSQL search provider (decision D-21).
 *
 * THE CENTRAL PROBLEM (clarification C-2): PostgreSQL ships no Hindi stemmer. The
 * approved resolution is that Hindi uses the `simple` configuration plus `pg_trgm`
 * trigram matching, while English uses the `english` configuration. That decision
 * is implemented literally here, per translation ROW:
 *
 *     (case when pt.locale = 'en' then 'english' else 'simple' end)::regconfig
 *
 * Choosing the configuration per row — rather than per request — matters because a
 * single query matches across both locales. A Hindi shopper must still find a
 * product that only has English copy, otherwise untranslated products silently
 * vanish from Hindi search, which is worse than showing English text.
 *
 * WHY RAW `sql` RATHER THAN THE QUERY BUILDER: the ranking expression needs a
 * per-row `regconfig` cast and `ts_rank`/`similarity` composition that the builder
 * cannot express. Every user value is still a bound parameter, so this is not a
 * string-concatenation injection risk. The statements are executed against a real
 * database by scripts/db-integration-check.sh, because Drizzle only typechecks the
 * builder and would not catch a malformed statement here.
 *
 * REQUIRES the `pg_trgm` extension, which the schema already depends on for its
 * trigram indexes.
 */

/**
 * Trigram floor for a fuzzy name match.
 *
 * 0.2 is deliberately loose: it catches typos and partial Devanagari words, which
 * is exactly where the missing Hindi stemmer hurts. Precision is recovered by
 * ranking — weak matches appear, but far down.
 */
const TRIGRAM_THRESHOLD = 0.2;

/**
 * Weight applied to the trigram score before adding it to `ts_rank`.
 *
 * `ts_rank` values are small (typically < 1), so an unweighted similarity would
 * dominate and turn full-text relevance into fuzzy name matching.
 */
const TRIGRAM_WEIGHT = 0.6;

/** Per-row text-search configuration. This IS clarification C-2. */
const rowConfig = sql`(case when pt.locale = 'en' then 'english' else 'simple' end)::regconfig`;

/** Per-row generated vector, matching the configuration above. */
const rowVector = sql`(case when pt.locale = 'en' then pt.search_vector_english else pt.search_vector_simple end)`;

export class PostgresSearchProvider implements SearchProvider {
  readonly name = 'postgres' as const;

  constructor(private readonly ctx: RepositoryContext) {}

  /**
   * `websearch_to_tsquery` rather than `to_tsquery`.
   *
   * It never raises a syntax error on arbitrary input — essential for a public
   * search box — and it understands quoted phrases and `-exclusions` the way people
   * already expect from search engines.
   */
  private tsQuery(term: string): SQL {
    return sql`websearch_to_tsquery(${rowConfig}, ${term})`;
  }

  /**
   * Products whose translations match, in ANY of the locales we consider.
   *
   * Scores are aggregated with `max` so a product matching in both locales is
   * ranked by its best match rather than counted twice.
   */
  private matchesCte(term: string, locale: Locale): SQL {
    const like = `%${term}%`;
    const locales = locale === defaultLocale ? [locale] : [locale, defaultLocale];

    const localeList = sql.join(
      locales.map((value) => sql`${value}`),
      sql`, `
    );

    return sql`
      select
        pt.product_id as product_id,
        max(
          ts_rank(${rowVector}, ${this.tsQuery(term)})
          + coalesce(similarity(pt.name, ${term}), 0) * ${TRIGRAM_WEIGHT}
        ) as score
      from product_translations pt
      where pt.locale in (${localeList})
        and (
          ${rowVector} @@ ${this.tsQuery(term)}
          or similarity(pt.name, ${term}) > ${TRIGRAM_THRESHOLD}
          or pt.name ilike ${like}
          or coalesce(pt.short_description, '') ilike ${like}
        )
      group by pt.product_id
    `;
  }

  /** Visibility and filter predicates, shared by the page and count queries. */
  private predicates(query: ProductSearchQuery): SQL {
    const conditions: SQL[] = [sql`p.status = 'ACTIVE'`, sql`p.deleted_at is null`];

    if (query.categoryIds && query.categoryIds.length > 0) {
      const ids = sql.join(
        query.categoryIds.map((id) => sql`${id}::uuid`),
        sql`, `
      );
      conditions.push(sql`p.category_id in (${ids})`);
    }

    if (query.minPricePaise !== undefined) {
      conditions.push(sql`p.price_paise >= ${query.minPricePaise}`);
    }
    if (query.maxPricePaise !== undefined) {
      conditions.push(sql`p.price_paise <= ${query.maxPricePaise}`);
    }

    if (query.inStockOnly) {
      // EXISTS rather than a join, so a product with several sellable variants is
      // not returned several times.
      conditions.push(sql`
        exists (
          select 1
          from product_variants pv
          join inventory i on i.variant_id = pv.id
          where pv.product_id = p.id
            and pv.deleted_at is null
            and pv.is_active = true
            and (i.track_inventory = false or i.quantity_available > 0)
        )
      `);
    }

    return sql.join(conditions, sql` and `);
  }

  private orderBy(sort: ProductSearchQuery['sort']): SQL {
    switch (sort) {
      case 'pricePaise:asc':
        return sql`p.price_paise asc, p.id asc`;
      case 'pricePaise:desc':
        return sql`p.price_paise desc, p.id desc`;
      case 'createdAt:desc':
        return sql`p.created_at desc, p.id desc`;
      case 'relevance':
      default:
        // Score first, then newest, then id — so equal scores never reorder
        // between requests.
        return sql`m.score desc, p.created_at desc, p.id desc`;
    }
  }

  async searchProducts(query: ProductSearchQuery): Promise<ProductSearchResult> {
    const limit = resolveLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const matches = this.matchesCte(query.term, query.locale);
    const where = this.predicates(query);

    const [rows, totals] = await Promise.all([
      this.ctx.db.execute<{ id: string; score: number | string }>(sql`
        with matches as (${matches})
        select p.id as id, m.score as score
        from products p
        join matches m on m.product_id = p.id
        where ${where}
        order by ${this.orderBy(query.sort)}
        limit ${limit + 1}
        offset ${offset}
      `),
      this.ctx.db.execute<{ total: number | string }>(sql`
        with matches as (${matches})
        select count(*)::int as total
        from products p
        join matches m on m.product_id = p.id
        where ${where}
      `),
    ]);

    const allRows = toRows<{ id: string; score: number | string }>(rows);
    const hasMore = allRows.length > limit;
    const page = hasMore ? allRows.slice(0, limit) : allRows;

    return {
      hits: page.map((row) => ({ productId: row.id, score: Number(row.score) })),
      total: Number(toRows<{ total: number | string }>(totals)[0]?.total ?? 0),
      hasMore,
    };
  }

  async searchCategories(term: string, locale: Locale, limit = 5): Promise<CategorySearchHit[]> {
    const like = `%${term}%`;
    const locales = locale === defaultLocale ? [locale] : [locale, defaultLocale];
    const localeList = sql.join(
      locales.map((value) => sql`${value}`),
      sql`, `
    );

    // Categories carry no generated vectors — they are short names, so trigram and
    // substring matching is both sufficient and cheaper than full-text.
    const rows = await this.ctx.db.execute<{
      id: string;
      slug: string;
      name: string;
      score: number | string;
    }>(sql`
      select
        c.id as id,
        c.slug as slug,
        -- Prefer the requested locale's name for display, falling back to English.
        coalesce(
          max(ct.name) filter (where ct.locale = ${locale}),
          max(ct.name) filter (where ct.locale = ${defaultLocale})
        ) as name,
        max(
          coalesce(similarity(ct.name, ${term}), 0)
          + case when ct.name ilike ${like} then 0.5 else 0 end
        ) as score
      from categories c
      join category_translations ct on ct.category_id = c.id
      where c.is_active = true
        and c.deleted_at is null
        and ct.locale in (${localeList})
        and (similarity(ct.name, ${term}) > ${TRIGRAM_THRESHOLD} or ct.name ilike ${like})
      group by c.id, c.slug
      order by score desc, c.display_order asc
      limit ${resolveLimit(limit)}
    `);

    return toRows<{ id: string; slug: string; name: string; score: number | string }>(rows)
      .filter((row) => row.name !== null)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        score: Number(row.score),
      }));
  }

  async suggest(term: string, locale: Locale, limit = 8): Promise<SearchSuggestion[]> {
    const like = `%${term}%`;
    const prefix = `${term}%`;
    const locales = locale === defaultLocale ? [locale] : [locale, defaultLocale];
    const localeList = sql.join(
      locales.map((value) => sql`${value}`),
      sql`, `
    );

    // Categories are unioned in and ranked above products: a category suggestion
    // leads somewhere broader and more useful than a single product.
    const rows = await this.ctx.db.execute<{
      text: string;
      kind: string;
      slug: string | null;
      score: number | string;
    }>(sql`
      (
        select
          ct.name as text,
          'category' as kind,
          c.slug as slug,
          coalesce(similarity(ct.name, ${term}), 0)
            + case when ct.name ilike ${prefix} then 1.0 else 0.4 end as score
        from categories c
        join category_translations ct on ct.category_id = c.id
        where c.is_active = true
          and c.deleted_at is null
          and ct.locale in (${localeList})
          and (ct.name ilike ${like} or similarity(ct.name, ${term}) > ${TRIGRAM_THRESHOLD})
      )
      union all
      (
        select
          pt.name as text,
          'product' as kind,
          null::text as slug,
          coalesce(similarity(pt.name, ${term}), 0)
            + case when pt.name ilike ${prefix} then 0.5 else 0 end as score
        from product_translations pt
        join products p on p.id = pt.product_id
        where p.status = 'ACTIVE'
          and p.deleted_at is null
          and pt.locale in (${localeList})
          and (pt.name ilike ${like} or similarity(pt.name, ${term}) > ${TRIGRAM_THRESHOLD})
      )
      order by score desc, text asc
      limit ${resolveLimit(limit)}
    `);

    return dedupeSuggestions(
      toRows<{ text: string; kind: string; slug: string | null }>(rows).map((row) => ({
        text: row.text,
        kind: row.kind === 'category' ? ('category' as const) : ('product' as const),
        slug: row.slug,
      }))
    );
  }
}

/**
 * Normalises a driver result into an array.
 *
 * `db.execute` returns different shapes across drivers — postgres.js yields an
 * array-like, node-postgres a `{ rows }` object. Normalising here means a driver
 * change cannot quietly turn every result into an empty list.
 */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: T[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

/** Suggestions are shown as text, so identical text twice is just noise. */
function dedupeSuggestions(suggestions: SearchSuggestion[]): SearchSuggestion[] {
  const seen = new Set<string>();
  const unique: SearchSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = suggestion.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(suggestion);
  }

  return unique;
}

export function createSearchProvider(ctx: RepositoryContext): SearchProvider {
  return new PostgresSearchProvider(ctx);
}
