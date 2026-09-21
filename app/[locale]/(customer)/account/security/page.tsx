import { PageShell } from '@/components/layout/page-shell';
import { SecurityActions } from '@/components/customer/security-actions';

export default function SecurityPage() {
  return (
    <PageShell title="Security">
      <SecurityActions />
    </PageShell>
  );
}
