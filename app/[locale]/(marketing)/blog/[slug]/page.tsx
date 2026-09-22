import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CmsContent } from '@/components/cms/cms-content';
import { PageShell } from '@/components/layout/page-shell';
import { defaultLocale, isLocale } from '@/i18n/routing';
import { imageUrlForKey } from '@/lib/catalog/image';
import { privatePageMetadata, publicPageMetadata, siteName } from '@/lib/seo/metadata';
import { readPublishedBlogPost } from '@/modules/blog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const resolved = isLocale(locale) ? locale : defaultLocale;
  const post = await readPublishedBlogPost(slug, resolved);

  if (!post) return privatePageMetadata('Blog');
  if (!post.robotsIndex) return privatePageMetadata(post.metaTitle ?? post.title);

  return publicPageMetadata({
    title: post.metaTitle ?? post.title,
    description: post.metaDescription ?? post.excerpt ?? post.title,
    path: '/blog/' + post.slug,
    locale: resolved,
    siteName: await siteName(resolved),
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const post = await readPublishedBlogPost(slug, locale);
  if (!post) notFound();

  const t = await getTranslations('marketing');
  const cover = imageUrlForKey(post.coverImageKey);

  return (
    <PageShell title={post.title}>
      <article className="mx-auto max-w-3xl">
        {post.usedFallbackLocale && locale === 'hi' ? (
          <p className="bg-muted mb-4 rounded-lg p-3 text-xs">{t('englishOnlyNotice')}</p>
        ) : null}

        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            className="mb-6 aspect-[16/8] w-full rounded-2xl object-cover"
            loading="eager"
            decoding="async"
          />
        ) : null}

        <div className="text-muted-foreground mb-6 flex flex-wrap gap-2 text-xs">
          {post.category ? <span>{post.category}</span> : null}
          <span>
            {(post.publishedAt ?? post.updatedAt).toLocaleDateString(
              locale === 'hi' ? 'hi-IN' : 'en-IN'
            )}
          </span>
        </div>

        {post.excerpt ? <p className="mb-6 text-base leading-relaxed">{post.excerpt}</p> : null}
        <CmsContent content={post.content} />
      </article>
    </PageShell>
  );
}
