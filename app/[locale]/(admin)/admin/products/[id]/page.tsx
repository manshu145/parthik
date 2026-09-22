import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { EntityActions } from '@/components/admin/entity-actions';
import { Card, CardContent } from '@/components/ui/card';
import { currentActorCan } from '@/lib/auth/current-actor';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { readAdminProductDetail } from '@/modules/admin-catalog';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('productDetail'), robots: { index: false, follow: false } };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('product:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [detail, t, format] = await Promise.all([
    readAdminProductDetail(id),
    getTranslations('adminNav'),
    getFormatter(),
  ]);

  if (!detail) notFound();

  const { product, variants } = detail;
  const canAct =
    product.status === 'DRAFT' || product.status === 'PENDING_REVIEW'
      ? await currentActorCan('product:approve')
      : await currentActorCan('product:manage');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-product-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{product.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {product.vendorName} · {product.storeName} · /{product.slug}
          </p>
        </div>
        <Badge variant={productStatusVariant(product.status)}>
          {product.status.replaceAll('_', ' ')}
        </Badge>
      </div>

      <EntityActions resource="product" id={product.id} status={product.status} allowed={canAct} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'मूल्य' : 'Pricing'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row
                label="Price"
                value={format.number(product.pricePaise / 100, {
                  style: 'currency',
                  currency: 'INR',
                })}
              />
              <Row
                label="MRP"
                value={format.number(product.mrpPaise / 100, {
                  style: 'currency',
                  currency: 'INR',
                })}
              />
              <Row
                label={locale === 'hi' ? 'लागत' : 'Private cost'}
                value={
                  product.costPaise === null
                    ? '—'
                    : format.number(product.costPaise / 100, {
                        style: 'currency',
                        currency: 'INR',
                      })
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'परफॉर्मेंस' : 'Performance'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label={locale === 'hi' ? 'बिक्री' : 'Sold'} value={String(product.soldCount)} />
              <Row label={locale === 'hi' ? 'व्यू' : 'Views'} value={String(product.viewCount)} />
              <Row
                label={locale === 'hi' ? 'रेटिंग' : 'Rating'}
                value={product.ratingAvg ? `${product.ratingAvg} (${product.ratingCount})` : '—'}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'रिकॉर्ड' : 'Record'}</h2>
            <dl className="mt-3 grid gap-2">
              <Row label="Version" value={String(product.version)} />
              <Row
                label={locale === 'hi' ? 'प्रकाशित' : 'Published'}
                value={
                  product.publishedAt
                    ? format.dateTime(product.publishedAt, { dateStyle: 'medium' })
                    : '—'
                }
              />
              <Row
                label={locale === 'hi' ? 'अपडेट' : 'Updated'}
                value={format.dateTime(product.updatedAt, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      {(product.shortDescription || product.description) && (
        <Card>
          <CardContent className="p-4 text-sm">
            <h2 className="font-semibold">{locale === 'hi' ? 'विवरण' : 'Description'}</h2>
            {product.shortDescription ? (
              <p className="mt-3 font-medium">{product.shortDescription}</p>
            ) : null}
            {product.description ? (
              <p className="text-muted-foreground mt-2 whitespace-pre-wrap">
                {product.description}
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">
              {locale === 'hi' ? 'Variants और stock' : 'Variants and stock'}
            </h2>
            <span className="text-muted-foreground text-xs">{variants.length} variants</span>
          </div>

          {variants.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">No variants found.</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-4 py-3 font-medium">SKU</th>
                      <th className="px-4 py-3 font-medium">Unit</th>
                      <th className="px-4 py-3 font-medium">Price</th>
                      <th className="px-4 py-3 font-medium">Available</th>
                      <th className="px-4 py-3 font-medium">Reserved</th>
                      <th className="px-4 py-3 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {variants.map((variant) => (
                      <tr key={variant.id}>
                        <td className="px-4 py-3 font-medium">{variant.sku ?? '—'}</td>
                        <td className="px-4 py-3">
                          {variant.unitLabel ?? product.unitLabel ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {format.number(variant.pricePaise / 100, {
                            style: 'currency',
                            currency: 'INR',
                          })}
                        </td>
                        <td className="px-4 py-3">{variant.quantityAvailable ?? '—'}</td>
                        <td className="px-4 py-3">{variant.quantityReserved ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {variant.isDefault ? <Badge variant="neutral">DEFAULT</Badge> : null}
                            <Badge variant={variant.isActive ? 'success' : 'danger'}>
                              {variant.isActive ? 'ACTIVE' : 'INACTIVE'}
                            </Badge>
                            {variant.trackInventory &&
                            variant.quantityAvailable !== null &&
                            variant.lowStockThreshold !== null &&
                            variant.quantityAvailable <= variant.lowStockThreshold ? (
                              <Badge
                                variant={variant.quantityAvailable === 0 ? 'danger' : 'warning'}
                              >
                                {variant.quantityAvailable === 0 ? 'OUT' : 'LOW'}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-sm">
          <h2 className="font-semibold">{t('productDetail')}</h2>
          <p className="text-muted-foreground mt-2">
            {locale === 'hi'
              ? 'Tax fields D-14 तय होने तक production UI में intentionally नहीं दिखाए जाते।'
              : 'Tax fields remain intentionally excluded from the production UI until D-14 is decided.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function productStatusVariant(status: string): BadgeVariant {
  if (status === 'ACTIVE') return 'success';
  if (status === 'REJECTED' || status === 'ARCHIVED') return 'danger';
  if (status === 'PENDING_REVIEW') return 'warning';
  return 'neutral';
}
