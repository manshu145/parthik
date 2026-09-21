import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { AddressBook } from '@/components/customer/address-book';
import { PageShell } from '@/components/layout/page-shell';

export const metadata: Metadata = { title: 'Addresses', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PageShell title="Saved addresses">
      <AddressBook />
    </PageShell>
  );
}
