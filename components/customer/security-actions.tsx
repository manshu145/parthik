'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function SecurityActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut(allDevices: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/auth/session', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allDevices }) });
      if (!response.ok) throw new Error('Could not sign out. Please retry.');
      router.replace('/login'); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not sign out.'); setBusy(false); }
  }
  return <div className="space-y-4"><div className="rounded-xl border p-4"><h2 className="font-semibold">Active session</h2><p className="text-muted-foreground mt-1 text-sm">End this browser session or revoke every active Parthik session.</p><div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy} onClick={() => signOut(false)}>Sign out</Button><Button variant="outline" disabled={busy} onClick={() => signOut(true)}>Sign out everywhere</Button></div>{error ? <p role="alert" className="text-danger mt-3 text-sm">{error}</p> : null}</div><p className="text-muted-foreground text-xs">Demo credential authentication is active. Password reset and Firebase verification will be enabled during the final authentication cutover.</p></div>;
}
