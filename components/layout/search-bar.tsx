'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Search entry point with typeahead suggestions.
 *
 * Progressive by construction: a real `<form>` with `role="search"` that submits to
 * `/search?q=` and works by keyboard and with Enter before any suggestion logic
 * runs. The dropdown is an enhancement, never a requirement.
 *
 * ACCESSIBILITY: implemented as the ARIA combobox pattern — `aria-expanded`,
 * `aria-controls` and `aria-activedescendant` on the input, with a `listbox` of
 * `option`s. Arrow keys move the active option, Enter accepts it, Escape closes.
 * Focus never leaves the input, which is what lets a screen-reader user keep typing.
 */

interface Suggestion {
  text: string;
  kind: 'product' | 'category';
  slug: string | null;
}

/** 250ms: fast enough to feel live, slow enough that a typed word is one request. */
const DEBOUNCE_MS = 250;
const MIN_TERM_LENGTH = 2;

export function SearchBar({
  className,
  autoFocus = false,
  onSubmitted,
}: {
  className?: string;
  autoFocus?: boolean;
  onSubmitted?: () => void;
}) {
  const t = useTranslations('search');
  const tCommon = useTranslations('common');
  // The locale of the PAGE, which is authoritative. Relying on the browser's
  // Accept-Language would return English suggestions to someone reading /hi.
  const locale = useLocale();
  const router = useRouter();

  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const closeSuggestions = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const submitTerm = useCallback(
    (value: string) => {
      const query = value.trim();
      if (query.length === 0) return;

      closeSuggestions();
      router.push({ pathname: '/search', query: { q: query } });
      onSubmitted?.();
    },
    [closeSuggestions, onSubmitted, router]
  );

  /**
   * Debounced suggestion fetch.
   *
   * Every state update happens INSIDE the timer callback rather than in the effect
   * body: that avoids cascading renders on each keystroke, and means a short term
   * does not briefly open an empty dropdown.
   */
  useEffect(() => {
    const trimmed = term.trim();
    const controller = new AbortController();

    const timer = setTimeout(() => {
      if (trimmed.length < MIN_TERM_LENGTH) {
        setSuggestions([]);
        setOpen(false);
        return;
      }

      const params = new URLSearchParams({ q: trimmed, limit: '8', locale });

      void fetch(`/api/v1/search/suggest?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('suggest failed');
          return response.json() as Promise<{ data?: { suggestions?: Suggestion[] } }>;
        })
        .then((body) => {
          if (controller.signal.aborted) return;
          const next = body.data?.suggestions ?? [];
          setSuggestions(next);
          setOpen(next.length > 0);
          setActiveIndex(-1);
        })
        .catch(() => {
          // A failed or superseded suggestion request must never break the form —
          // the customer can still press Enter and search.
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setOpen(false);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, locale]);

  const acceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      closeSuggestions();

      if (suggestion.kind === 'category' && suggestion.slug) {
        // A category suggestion goes straight to the listing rather than running a
        // search that would only rediscover it.
        setTerm(suggestion.text);
        router.push(`/category/${suggestion.slug}`);
        onSubmitted?.();
        return;
      }

      setTerm(suggestion.text);
      submitTerm(suggestion.text);
    },
    [closeSuggestions, onSubmitted, router, submitTerm]
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      closeSuggestions();
      return;
    }

    if (!isOpen || suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }

    if (event.key === 'Enter' && activeIndex >= 0) {
      const suggestion = suggestions[activeIndex];
      if (suggestion) {
        // Accepting the highlighted option must win over submitting the raw text.
        event.preventDefault();
        acceptSuggestion(suggestion);
      }
    }
  }

  const activeId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <form
      role="search"
      aria-label={t('label')}
      onSubmit={(event) => {
        event.preventDefault();
        submitTerm(term);
      }}
      data-testid="search-bar"
      className={cn('relative flex w-full items-center', className)}
    >
      <label htmlFor="site-search" className="sr-only">
        {t('label')}
      </label>

      <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute left-3 size-4"
      />

      <input
        id="site-search"
        ref={inputRef}
        name="q"
        type="search"
        value={term}
        autoFocus={autoFocus}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={handleKeyDown}
        // Closing on blur is deferred so a click on an option lands before the
        // dropdown unmounts.
        onBlur={() => setTimeout(closeSuggestions, 120)}
        placeholder={t('placeholder')}
        autoComplete="off"
        enterKeyHint="search"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        {...(activeId ? { 'aria-activedescendant': activeId } : {})}
        className={cn(
          'border-input bg-background h-11 w-full rounded-[var(--radius-control)] border',
          'placeholder:text-muted-foreground pr-9 pl-9 text-sm',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
        )}
      />

      {term.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setTerm('');
            setSuggestions([]);
            closeSuggestions();
            inputRef.current?.focus();
          }}
          aria-label={tCommon('clear')}
          data-testid="search-clear"
          className="text-muted-foreground hover:text-foreground absolute right-2 p-1"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}

      {isOpen && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('suggestionsLabel')}
          data-testid="search-suggestions"
          className={cn(
            'border-border bg-popover absolute top-full left-0 z-50 mt-1 w-full',
            'divide-border divide-y overflow-hidden rounded-[var(--radius-control)] border shadow-md'
          )}
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={`${suggestion.kind}-${suggestion.text}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              data-testid="search-suggestion"
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                index === activeIndex ? 'bg-muted' : 'hover:bg-muted'
              )}
              // onMouseDown, not onClick: it fires before the input's blur, so the
              // dropdown is still mounted when the selection is made.
              onMouseDown={(event) => {
                event.preventDefault();
                acceptSuggestion(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="truncate">{suggestion.text}</span>
              {suggestion.kind === 'category' && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {t('matchingCategories')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
