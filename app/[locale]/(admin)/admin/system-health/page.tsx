import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AccessDenied } from '@/app/_components/access-denied';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { checkPagePermission } from '@/lib/auth/page-guard';
import { getHealthReport, type ComponentState } from '@/lib/observability/health';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'adminNav' });
  return { title: t('systemHealth'), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await checkPagePermission('system:view');
  if (access.status !== 'ok') return <AccessDenied decision={access} />;

  const [report, t] = await Promise.all([getHealthReport(), getTranslations('adminNav')]);
  const configured = report.components.filter((component) => component.state === 'ok').length;
  const missing = report.components.filter(
    (component) => component.state === 'not_configured'
  ).length;
  const unhealthy = report.components.filter(
    (component) => component.state === 'degraded' || component.state === 'error'
  ).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="admin-system-health">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('systemHealth')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {locale === 'hi'
              ? 'Runtime configuration और external provider readiness का live snapshot। Secrets कभी display नहीं होते।'
              : 'Live snapshot of runtime configuration and external provider readiness. Secret values are never displayed.'}
          </p>
        </div>
        <Badge
          variant={
            report.status === 'ok' ? 'success' : report.status === 'degraded' ? 'warning' : 'danger'
          }
        >
          {report.status.toUpperCase()}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Environment" value={report.environment} />
        <Metric label="Configured" value={configured} />
        <Metric label="Not configured" value={missing} />
        <Metric label="Degraded / error" value={unhealthy} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {report.components.map((component) => (
          <Card key={component.name}>
            <CardContent className="p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{component.name}</h2>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {component.required ? 'Required dependency' : 'Optional / feature dependency'}
                  </p>
                </div>
                <Badge variant={healthVariant(component.state)}>
                  {component.state.replaceAll('_', ' ').toUpperCase()}
                </Badge>
              </div>
              {component.detail ? (
                <p className="text-muted-foreground mt-3 leading-5">{component.detail}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Snapshot generated {report.timestamp}. This page reports configuration readiness; it does
        not expose credentials.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="truncate text-xl font-semibold">{value}</p>
        <p className="text-muted-foreground mt-1 text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}

function healthVariant(state: ComponentState): BadgeVariant {
  if (state === 'ok') return 'success';
  if (state === 'degraded' || state === 'not_configured') return 'warning';
  return 'danger';
}
