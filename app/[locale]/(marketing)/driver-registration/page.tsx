import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { getCurrentActor, requireCurrentActor } from '@/lib/auth/current-actor';
import {
  getOwnDriverApplication,
  submitDriverApplication,
} from '@/modules/partner-applications';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Become a delivery partner',
  description: 'Apply to deliver with Parthik.',
};

const VEHICLES = ['BIKE', 'SCOOTER', 'BICYCLE', 'CAR', 'VAN'] as const;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const actor = await getCurrentActor();
  const application = actor ? await getOwnDriverApplication(actor.userId) : null;
  const isHindi = locale === 'hi';

  async function apply(formData: FormData) {
    'use server';
    const current = await requireCurrentActor();
    const vehicle = String(formData.get('vehicleType') ?? 'BIKE');
    const vehicleType = VEHICLES.includes(vehicle as (typeof VEHICLES)[number])
      ? (vehicle as (typeof VEHICLES)[number])
      : 'BIKE';

    try {
      await submitDriverApplication(current.userId, {
        fullName: String(formData.get('fullName') ?? ''),
        phone: String(formData.get('phone') ?? ''),
        emergencyContact: String(formData.get('emergencyContact') ?? ''),
        vehicleType,
        registrationNumber: String(formData.get('registrationNumber') ?? ''),
        makeModel: String(formData.get('makeModel') ?? ''),
      });
    } catch {
      redirect('/driver-registration?error=application');
    }

    redirect('/driver-registration?submitted=1');
  }

  return (
    <PageShell title={isHindi ? 'Delivery partner बनें' : 'Become a delivery partner'}>
      <div className="mx-auto max-w-2xl space-y-6">
        <p className="text-muted-foreground leading-7">
          {isHindi
            ? 'Parthik के साथ deliveries करें। Approval के बाद driver dashboard से availability, assigned deliveries और earnings manage करें।'
            : 'Deliver with Parthik. After approval, use the driver dashboard to manage availability, assigned deliveries and earnings.'}
        </p>

        {!actor ? (
          <div className="rounded-xl border p-5">
            <h2 className="font-semibold">{isHindi ? 'पहले sign in करें' : 'Sign in first'}</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {isHindi
                ? 'Delivery application आपके verified account से linked होगी।'
                : 'Your delivery application is linked to your verified account.'}
            </p>
            <Button asChild className="mt-4">
              <Link href="/login?next=/driver-registration">Sign in / OTP</Link>
            </Button>
          </div>
        ) : application ? (
          <div className="rounded-xl border p-5" data-testid="driver-application-status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{application.fullName}</h2>
                <p className="text-muted-foreground mt-1 text-sm">{application.driverCode}</p>
              </div>
              <span className="rounded-full border px-3 py-1 text-xs font-semibold">
                {application.status.replaceAll('_', ' ')}
              </span>
            </div>
            {application.rejectionReason ? (
              <p className="text-danger mt-3 text-sm">{application.rejectionReason}</p>
            ) : null}
            {application.status === 'APPROVED' ? (
              <Button asChild className="mt-4">
                <Link href="/driver">{isHindi ? 'Driver dashboard खोलें' : 'Open driver dashboard'}</Link>
              </Button>
            ) : (
              <p className="text-muted-foreground mt-4 text-sm">
                {isHindi
                  ? 'Admin approval के बाद driver access automatically activate होगा।'
                  : 'Driver access will activate automatically after admin approval.'}
              </p>
            )}
          </div>
        ) : (
          <form action={apply} className="space-y-5 rounded-xl border p-5" data-testid="driver-application-form">
            <div>
              <h2 className="font-semibold">{isHindi ? 'Driver details' : 'Driver details'}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {isHindi ? 'Approval के लिए सही details भरें।' : 'Enter accurate details for approval.'}
              </p>
            </div>

            {query.error ? (
              <p className="text-danger text-sm" role="alert">
                {isHindi ? 'Application submit नहीं हो सकी। Details check करें।' : 'Application could not be submitted. Check the details and try again.'}
              </p>
            ) : null}

            <Field label="Full name" name="fullName" required defaultValue={actor.fullName ?? ''} />
            <Field label="Phone" name="phone" type="tel" required defaultValue={actor.phone ?? ''} />
            <Field label="Emergency contact" name="emergencyContact" type="tel" />

            <label className="block space-y-2 text-sm">
              <span className="font-medium">Vehicle type</span>
              <select name="vehicleType" className="bg-background h-11 w-full rounded-lg border px-3" defaultValue="BIKE">
                {VEHICLES.map((vehicle) => (
                  <option key={vehicle} value={vehicle}>
                    {vehicle.charAt(0) + vehicle.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>

            <Field label="Vehicle registration number" name="registrationNumber" />
            <Field label="Vehicle make / model" name="makeModel" />

            <Button type="submit" className="w-full">
              {isHindi ? 'Delivery partner application submit करें' : 'Submit delivery partner application'}
            </Button>
          </form>
        )}
      </div>
    </PageShell>
  );
}

function Field({
  label,
  name,
  required,
  type = 'text',
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      <Input name={name} required={required} type={type} defaultValue={defaultValue} maxLength={160} />
    </label>
  );
}
