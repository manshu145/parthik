import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { listAdminProducts } from '@/modules/admin-catalog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('products'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('product:list');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [products, t, format] = await Promise.all([
    listAdminProducts(),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-products">
      <div>
        <h1 className="text-xl font-semibold">{t('products')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {locale === 'hi'
            ? 'सभी vendors का live catalog और publishing status.'
            : 'Live catalog and publishing status across all vendors.'}
        </p>
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            {locale === 'hi' ? 'अभी कोई product नहीं है।' : 'No products yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Vendor / Store</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Sold</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {products.map((product) => (
                  <tr key={product.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="text-muted-foreground mt-1 text-xs">/{product.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{product.vendorName}</p>
                      <p className="text-muted-foreground mt-1 text-xs">{product.storeName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={productStatusVariant(product.status)}>{product.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {format.number(product.pricePaise / 100, {
                          style: 'currency',
                          currency: 'INR',
                        })}
                      </p>
                      {product.mrpPaise !== product.pricePaise && (
                        <p className="text-muted-foreground mt-1 text-xs line-through">
                          {format.number(product.mrpPaise / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {product.soldCount}
                      {product.ratingAvg ? (
                        <p className="text-muted-foreground mt-1 text-xs">★ {product.ratingAvg}</p>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {format.dateTime(product.updatedAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function productStatusVariant(status: string): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'REJECTED' || status === 'ARCHIVED') return 'danger';
  if (status === 'PENDING_REVIEW') return 'warning';
  return 'neutral';
}
