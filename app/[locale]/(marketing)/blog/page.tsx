import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { EmptyState } from '@/components/feedback/states';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { imageUrlForKey } from '@/lib/catalog/image';
import { publicPageMetadata, siteName } from '@/lib/seo/metadata';
import { listPublishedBlogPosts } from '@/modules/blog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved = isLocale(locale) ? locale : defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: 'marketing' });

  return publicPageMetadata({
    title: t('titles.blog'),
    description: t('defaultDescription'),
    path: '/blog',
    locale: resolved,
    siteName: await siteName(resolved),
  });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('marketing');
  const posts = await listPublishedBlogPosts(locale);

  return (
    <PageShell title={t('titles.blog')}>
      {posts.length === 0 ? (
        <EmptyState title="No articles yet" description="Published articles will appear here." />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {posts.map((post) => {
            const image = imageUrlForKey(post.coverImageKey);
            const href = locale === defaultLocale ? '/blog/' + post.slug : '/' + locale + '/blog/' + post.slug;

            return (
              <article key={post.id} className="overflow-hidden rounded-2xl border">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt=""
                    className="aspect-[16/8] w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
                <div className="space-y-3 p-5">
                  <div className="flex flex-wrap gap-2 text-xs">
                    {post.category ? (
                      <span className="bg-muted rounded-full px-2 py-1">{post.category}</span>
                    ) : null}
                    {post.usedFallbackLocale && locale === 'hi' ? (
                      <span className="bg-muted rounded-full px-2 py-1">English</span>
                    ) : null}
                  </div>
                  <h2 className="text-lg font-semibold">
                    <a href={href} className="hover:underline">
                      {post.title}
                    </a>
                  </h2>
                  {post.excerpt ? (
                    <p className="text-muted-foreground text-sm leading-relaxed">{post.excerpt}</p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {(post.publishedAt ?? post.updatedAt).toLocaleDateString(
                      locale === 'hi' ? 'hi-IN' : 'en-IN'
                    )}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
