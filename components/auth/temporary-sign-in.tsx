'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ACCOUNTS = ['customer', 'vendor', 'driver', 'admin', 'support'] as const;

export function TemporarySignIn({ nextPath }: { nextPath?: string | undefined }) {
  const router = useRouter();
  const [username, setUsername] = useState<(typeof ACCOUNTS)[number]>('customer');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/auth/dev-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; data?: { landingPath?: string }; error?: { message?: string } }
        | null;

      if (!response.ok || !payload?.success) {
        setError(payload?.error?.message ?? 'Invalid username or password.');
        return;
      }

      router.replace(nextPath ?? payload.data?.landingPath ?? '/');
      router.refresh();
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="temporary-signin-form">
      <div className="space-y-2">
        <label htmlFor="username" className="block text-sm font-medium">Dashboard</label>
        <select
          id="username"
          className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          value={username}
          onChange={(event) => setUsername(event.target.value as (typeof ACCOUNTS)[number])}
          disabled={busy}
        >
          {ACCOUNTS.map((account) => (
            <option key={account} value={account}>{account.charAt(0).toUpperCase() + account.slice(1)}</option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">Password</label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          required
        />
      </div>
      {error ? <p className="text-destructive text-sm" role="alert">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy || password.length === 0}>
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-muted-foreground text-xs">Temporary testing login. Firebase OTP is disabled.</p>
    </form>
  );
}
