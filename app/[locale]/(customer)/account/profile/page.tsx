import { revalidatePath } from 'next/cache';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { updateCustomerProfile } from '@/modules/customer-account';

export default async function Page() {
  const actor = await requireCurrentActor();
  async function save(formData: FormData) { 'use server'; const current = await requireCurrentActor(); const fullName = String(formData.get('fullName') ?? '').trim(); const preferredLocale = formData.get('preferredLocale') === 'hi' ? 'hi' : 'en'; if (fullName.length < 2) return; await updateCustomerProfile(current.userId, { fullName, preferredLocale }); revalidatePath('/account/profile'); }
  return <PageShell title="Profile"><form action={save} className="max-w-xl space-y-4 rounded-xl border p-4"><label className="space-y-1 text-sm"><span>Full name</span><Input name="fullName" required minLength={2} defaultValue={actor.fullName ?? ''} /></label><label className="space-y-1 text-sm"><span>Phone</span><Input value={actor.phone ?? ''} disabled /></label><label className="space-y-1 text-sm"><span>Language</span><select name="preferredLocale" defaultValue={actor.preferredLocale} className="h-10 w-full rounded-lg border bg-background px-3"><option value="en">English</option><option value="hi">Hindi</option></select></label><Button type="submit">Save profile</Button></form></PageShell>;
}
