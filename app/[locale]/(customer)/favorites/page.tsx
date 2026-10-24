import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { listFavorites, removeFavorite } from '@/modules/customer-account';

/**
 * Favorites — SHELL ONLY.
 *
 * Session-gated by middleware, so an unauthenticated visitor is redirected to
 * `/login?next=/favorites` before this renders.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.favorites' });

  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function FavoritesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.favorites');
  const actor = await requireCurrentActor();
  const items = await listFavorites(actor.userId);
  async function remove(formData: FormData) {
    'use server';
    const current = await requireCurrentActor();
    await removeFavorite(current.userId, String(formData.get('id')));
    revalidatePath('/favorites');
  }

  return (
    <PageShell title={t('heading')}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.length === 0 ? (
          <div className="rounded-xl border p-6">
            <p className="font-medium">No favorites yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Products saved for later will appear here.
            </p>
            <Button asChild className="mt-4">
              <Link href="/">Browse products</Link>
            </Button>
          </div>
        ) : (
          items.map((item) => (
            <article key={item.id} className="rounded-xl border p-4">
              <Link href={`/products/${item.slug}`} className="font-semibold hover:underline">
                {item.name}
              </Link>
              <p className="text-muted-foreground mt-1 text-sm">
                {item.unitLabel ?? 'Standard unit'}
              </p>
              <p className="mt-3 font-medium">₹{(item.pricePaise / 100).toFixed(2)}</p>
              <form action={remove} className="mt-4">
                <input type="hidden" name="id" value={item.id} />
                <Button type="submit" variant="outline" size="sm">
                  Remove
                </Button>
              </form>
            </article>
          ))
        )}
      </div>
    </PageShell>
  );
}
