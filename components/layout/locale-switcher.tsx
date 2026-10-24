'use client';

import { useTransition } from 'react';
import { useParams } from 'next/navigation';
import { localeNames, locales, type Locale } from '@/i18n/routing';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Locale switcher (D-33).
 *
 * Preserves the current path when switching so changing language never dumps the
 * user back on the homepage (docs/ROUTES.md §2.1) — losing your place mid-task is
 * exactly the kind of thing that stops people using the other language.
 */
export function LocaleSwitcher({ label }: { label: string }) {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const active = (params.locale as Locale | undefined) ?? 'en';

  function switchTo(locale: Locale) {
    if (locale === active) return;
    startTransition(() => {
      // Casting is required because next-intl types pathname against known
      // routes; here we are re-navigating to the same dynamic path.
      router.replace(pathname as Parameters<typeof router.replace>[0], { locale });
    });
  }

  return (
    <nav aria-label={label} className="flex items-center gap-1">
      {locales.map((locale) => {
        const isActive = locale === active;

        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-current={isActive ? 'true' : undefined}
            disabled={isPending}
            onClick={() => switchTo(locale)}
            className={cn(
              'min-h-[var(--size-tap-target)] rounded-[var(--radius-control)] px-3 text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
              'disabled:opacity-50',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {localeNames[locale]}
          </button>
        );
      })}
    </nav>
  );
}
