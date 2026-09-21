import { revalidatePath } from 'next/cache';
import { PageShell } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireCurrentActor } from '@/lib/auth/current-actor';
import { createSupportTicket } from '@/modules/customer-account';
import { listSupportTicketsForUser } from '@/modules/support';

export const dynamic = 'force-dynamic';
export default async function Page() {
  const actor = await requireCurrentActor();
  const items = await listSupportTicketsForUser(actor.userId);
  async function create(formData: FormData) {
    'use server';
    const current = await requireCurrentActor();
    const subject = String(formData.get('subject') ?? '').trim();
    if (subject.length < 3) return;
    const allowed = [
      'PAYMENT',
      'DELIVERY',
      'PRODUCT',
      'REFUND',
      'COUPON',
      'ACCOUNT',
      'VENDOR',
      'OTHER',
    ] as const;
    const raw = String(formData.get('category') ?? 'OTHER');
    const category = allowed.find((item) => item === raw) ?? 'OTHER';
    await createSupportTicket(current.userId, { category, subject });
    revalidatePath('/account/support');
  }
  return (
    <PageShell title="Support">
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={create} className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">Create ticket</h2>
          <select name="category" className="bg-background h-10 w-full rounded-lg border px-3">
            {['PAYMENT', 'DELIVERY', 'PRODUCT', 'REFUND', 'COUPON', 'ACCOUNT', 'OTHER'].map(
              (item) => (
                <option key={item}>{item}</option>
              )
            )}
          </select>
          <Input name="subject" required minLength={3} placeholder="How can we help?" />
          <Button type="submit">Submit ticket</Button>
        </form>
        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">No support tickets.</p>
          ) : (
            items.map((item) => (
              <article key={item.id} className="rounded-xl border p-4">
                <p className="font-medium">
                  {item.ticketNumber} · {item.subject}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {item.category} · {item.status} · {item.priority}
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
