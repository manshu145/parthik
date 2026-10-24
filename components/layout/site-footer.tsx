'use client';

import { useTranslations } from 'next-intl';
import { FOOTER_SECTIONS } from '@/lib/navigation/nav-config';
import { LocaleSwitcher } from './locale-switcher';
import { NavLink } from './nav-link';

/**
 * Site footer (master spec §2, docs/ROUTES.md §3).
 *
 * Preserves the existing site's footer — About, Privacy, Terms, Vendor
 * Registration, Driver Registration — and adds the remaining legal pages the
 * route map defines. Sections come from the shared navigation config, so a link
 * is never declared twice.
 *
 * Extra bottom padding on mobile keeps the last links clear of the fixed bottom
 * navigation.
 */
export function SiteFooter() {
  const t = useTranslations('footer');
  const tCommon = useTranslations('common');
  const year = new Date().getFullYear();

  return (
    <footer data-testid="site-footer" className="border-border bg-muted/40 border-t pb-24 md:pb-0">
      <div className="mx-auto w-full max-w-7xl px-4 py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {FOOTER_SECTIONS.map((section) => (
            <nav key={section.id} aria-labelledby={`footer-${section.id}`}>
              <h2
                id={`footer-${section.id}`}
                className="text-foreground mb-3 text-sm font-semibold"
              >
                {t(section.titleKey)}
              </h2>
              <ul className="flex flex-col gap-2">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      item={item}
                      label={t(item.labelKey)}
                      className="text-muted-foreground hover:text-foreground inline-flex min-h-[2rem] items-center text-sm transition-colors"
                      activeClassName="text-foreground underline"
                    />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-border mt-10 flex flex-col gap-4 border-t pt-6 md:flex-row md:items-center md:justify-between">
          <p className="text-muted-foreground text-sm">
            © {year} {tCommon('appName')}. {t('rightsReserved')}
          </p>
          {/* Also in the footer so mobile users, who have no header switcher,
              can still change language. */}
          <LocaleSwitcher label={tCommon('changeLanguage')} />
        </div>
      </div>
    </footer>
  );
}
