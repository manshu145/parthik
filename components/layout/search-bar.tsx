'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Search entry point — SHELL ONLY.
 *
 * Submits to `/search?q=`, which is the real route from docs/ROUTES.md §4. It
 * performs no querying, no suggestions and no debouncing; search itself is TASK
 * 007.
 *
 * Implemented as a real `<form>` with `role="search"` so it works by keyboard and
 * with Enter before any JavaScript behaviour is added.
 */
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
  const router = useRouter();
  const [term, setTerm] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = term.trim();
    if (query.length === 0) return;

    router.push({ pathname: '/search', query: { q: query } });
    onSubmitted?.();
  }

  return (
    <form
      role="search"
      aria-label={t('label')}
      onSubmit={handleSubmit}
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
        name="q"
        type="search"
        value={term}
        autoFocus={autoFocus}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t('placeholder')}
        autoComplete="off"
        enterKeyHint="search"
        className={cn(
          'border-input bg-background h-11 w-full rounded-[var(--radius-control)] border',
          'placeholder:text-muted-foreground pr-3 pl-9 text-sm',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]'
        )}
      />
    </form>
  );
}
