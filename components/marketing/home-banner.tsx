import { imageUrlForKey } from '@/lib/catalog/image';
import { defaultLocale, type Locale } from '@/i18n/routing';
interface HomeBannerView {
  id: string;
  placement: 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';
  linkUrl: string | null;
  priority: number;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  imageKey: string | null;
  mobileImageKey: string | null;
}

export function HomeBannerGrid({
  banners,
  locale,
}: {
  banners: HomeBannerView[];
  locale: Locale;
}) {
  if (banners.length === 0) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {banners.map((banner) => {
        const desktop = imageUrlForKey(banner.imageKey);
        const mobile = imageUrlForKey(banner.mobileImageKey);
        const href = banner.linkUrl ? localiseRelativeUrl(banner.linkUrl, locale) : null;

        const content = (
          <article className="bg-muted/40 relative min-h-44 overflow-hidden rounded-2xl border p-5">
            {desktop || mobile ? (
              <picture className="absolute inset-0">
                {mobile ? <source media="(max-width: 640px)" srcSet={mobile} /> : null}
                {desktop ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={desktop}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </picture>
            ) : null}

            <div
              className={
                desktop || mobile
                  ? 'bg-background/90 relative z-10 max-w-md rounded-xl p-4 backdrop-blur-sm'
                  : 'relative z-10 max-w-md'
              }
            >
              <h2 className="text-lg font-semibold">{banner.title}</h2>
              {banner.subtitle ? (
                <p className="text-muted-foreground mt-2 text-sm">{banner.subtitle}</p>
              ) : null}
              {banner.ctaLabel && href ? (
                <span className="bg-primary text-primary-foreground mt-4 inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium">
                  {banner.ctaLabel}
                </span>
              ) : null}
            </div>
          </article>
        );

        return href ? (
          <a
            key={banner.id}
            href={href}
            className="block focus-visible:outline-none focus-visible:ring-2"
          >
            {content}
          </a>
        ) : (
          <div key={banner.id}>{content}</div>
        );
      })}
    </div>
  );
}

function localiseRelativeUrl(value: string, locale: Locale): string {
  if (!value.startsWith('/')) return value;
  if (locale === defaultLocale) return value;
  return '/' + locale + value;
}
