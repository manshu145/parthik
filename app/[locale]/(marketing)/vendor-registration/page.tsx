import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { getCurrentActor, requireCurrentActor } from '@/lib/auth/current-actor';
import { getOwnVendorApplication, submitVendorApplication } from '@/modules/partner-applications';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Become a vendor',
  description: 'Apply to sell on Parthik.',
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const actor = await getCurrentActor();
  const application = actor ? await getOwnVendorApplication(actor.userId) : null;
  const isHindi = locale === 'hi';

  async function apply(formData: FormData) {
    'use server';
    const current = await requireCurrentActor();

    try {
      await submitVendorApplication(current.userId, {
        businessName: String(formData.get('businessName') ?? ''),
        legalName: String(formData.get('legalName') ?? ''),
        gstin: String(formData.get('gstin') ?? ''),
        fssaiLicense: String(formData.get('fssaiLicense') ?? ''),
        contactPhone: String(formData.get('contactPhone') ?? ''),
        storeName: String(formData.get('storeName') ?? ''),
        line1: String(formData.get('line1') ?? ''),
        city: String(formData.get('city') ?? ''),
        state: String(formData.get('state') ?? ''),
        pincode: String(formData.get('pincode') ?? ''),
      });
    } catch {
      redirect('/vendor-registration?error=application');
    }

    redirect('/vendor-registration?submitted=1');
  }

  return (
    <PageShell title={isHindi ? 'Vendor बनें' : 'Become a vendor'}>
      <div className="mx-auto max-w-2xl space-y-6">
        <p className="text-muted-foreground leading-7">
          {isHindi
            ? 'Parthik पर अपना store, products, inventory और orders manage करें। आवेदन review के बाद vendor dashboard access activate होगा।'
            : 'Sell on Parthik and manage your store, products, inventory and orders. Vendor dashboard access is activated after application review.'}
        </p>

        {!actor ? (
          <div className="rounded-xl border p-5">
            <h2 className="font-semibold">{isHindi ? 'पहले sign in करें' : 'Sign in first'}</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {isHindi
                ? 'Vendor application आपके verified Parthik account से linked होगी।'
                : 'Your vendor application is linked to your verified Parthik account.'}
            </p>
            <Button asChild className="mt-4">
              <Link href="/login?next=/vendor-registration">
                {isHindi ? 'Sign in / OTP' : 'Sign in / OTP'}
              </Link>
            </Button>
          </div>
        ) : application ? (
          <div className="rounded-xl border p-5" data-testid="vendor-application-status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{application.businessName}</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {isHindi
                    ? 'आपका आवेदन submit हो चुका है।'
                    : 'Your application has been submitted.'}
                </p>
              </div>
              <span className="rounded-full border px-3 py-1 text-xs font-semibold">
                {application.status.replaceAll('_', ' ')}
              </span>
            </div>
            {application.rejectionReason || application.suspensionReason ? (
              <p className="text-danger mt-3 text-sm">
                {application.rejectionReason ?? application.suspensionReason}
              </p>
            ) : null}
            {application.status === 'APPROVED' ? (
              <Button asChild className="mt-4">
                <Link href="/vendor">
                  {isHindi ? 'Vendor dashboard खोलें' : 'Open vendor dashboard'}
                </Link>
              </Button>
            ) : (
              <p className="text-muted-foreground mt-4 text-sm">
                {isHindi
                  ? 'Admin review complete होने पर dashboard access automatically activate होगा।'
                  : 'Dashboard access will activate automatically after admin approval.'}
              </p>
            )}
          </div>
        ) : (
          <form
            action={apply}
            className="space-y-5 rounded-xl border p-5"
            data-testid="vendor-application-form"
          >
            <div>
              <h2 className="font-semibold">{isHindi ? 'Business details' : 'Business details'}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {isHindi
                  ? 'सही जानकारी भरें; admin review करेगा।'
                  : 'Enter accurate details for admin review.'}
              </p>
            </div>

            {query.error ? (
              <p className="text-danger text-sm" role="alert">
                {isHindi
                  ? 'Application submit नहीं हो सकी। Details check करके फिर try करें।'
                  : 'Application could not be submitted. Check the details and try again.'}
              </p>
            ) : null}

            <Field label="Business name" name="businessName" required />
            <Field label="Legal name" name="legalName" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GSTIN" name="gstin" />
              <Field label="FSSAI licence" name="fssaiLicense" />
            </div>
            <Field
              label="Contact phone"
              name="contactPhone"
              type="tel"
              required
              defaultValue={actor.phone ?? ''}
            />

            <div className="border-t pt-5">
              <h3 className="font-semibold">{isHindi ? 'Store details' : 'Store details'}</h3>
            </div>
            <Field label="Store name" name="storeName" required />
            <Field label="Store address" name="line1" required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City" name="city" required />
              <Field label="State" name="state" required />
            </div>
            <Field label="Pincode" name="pincode" inputMode="numeric" required />

            <Button type="submit" className="w-full">
              {isHindi ? 'Vendor application submit करें' : 'Submit vendor application'}
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
  inputMode,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  inputMode?: 'numeric';
  defaultValue?: string;
}) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        name={name}
        required={required}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        maxLength={250}
      />
    </label>
  );
}
