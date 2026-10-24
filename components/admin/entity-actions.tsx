'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Resource = 'vendor' | 'driver' | 'product' | 'customer';
type Action = {
  key: string;
  label: string;
  danger?: boolean;
  reasonRequired?: boolean;
};

export function EntityActions({
  resource,
  id,
  status,
  allowed = true,
}: {
  resource: Resource;
  id: string;
  status: string;
  allowed?: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useMemo(() => actionsFor(resource, status), [resource, status]);

  if (!allowed || actions.length === 0) return null;

  async function run(action: Action) {
    if (action.reasonRequired && !reason.trim()) {
      setError('Enter a reason before continuing.');
      return;
    }

    setBusy(action.key);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/actions/' + resource + '/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.key, reason: reason.trim() || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Action failed.');
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border p-4" data-testid={'admin-' + resource + '-actions'}>
      <p className="text-sm font-semibold">Admin actions</p>
      {actions.some((action) => action.reasonRequired) ? (
        <Input
          className="mt-3"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (required for reject/suspend/ban)"
          maxLength={1000}
          disabled={busy !== null}
        />
      ) : null}
      {error ? (
        <p className="text-danger mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            size="sm"
            variant={action.danger ? 'danger' : 'secondary'}
            disabled={busy !== null}
            onClick={() => void run(action)}
          >
            {busy === action.key ? 'Working…' : action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function actionsFor(resource: Resource, status: string): Action[] {
  if (resource === 'vendor' || resource === 'driver') {
    if (status === 'APPLIED' || status === 'UNDER_REVIEW') {
      return [
        { key: 'approve', label: 'Approve' },
        { key: 'reject', label: 'Reject', danger: true, reasonRequired: true },
      ];
    }
    if (status === 'APPROVED') {
      return [{ key: 'suspend', label: 'Suspend', danger: true, reasonRequired: true }];
    }
    if (status === 'SUSPENDED' || status === 'REJECTED') {
      return [{ key: 'reactivate', label: 'Reactivate' }];
    }
  }

  if (resource === 'product') {
    if (status === 'DRAFT' || status === 'PENDING_REVIEW') {
      return [
        { key: 'approve', label: 'Approve & publish' },
        { key: 'reject', label: 'Reject', danger: true, reasonRequired: true },
      ];
    }
    if (status === 'ACTIVE') {
      return [{ key: 'deactivate', label: 'Deactivate', danger: true }];
    }
    if (status === 'INACTIVE' || status === 'REJECTED') {
      return [{ key: 'reactivate', label: 'Activate' }];
    }
  }

  if (resource === 'customer') {
    if (status === 'ACTIVE') {
      return [
        { key: 'suspend', label: 'Suspend', danger: true, reasonRequired: true },
        { key: 'ban', label: 'Ban', danger: true, reasonRequired: true },
      ];
    }
    if (status === 'SUSPENDED' || status === 'BANNED') {
      return [{ key: 'activate', label: 'Reactivate' }];
    }
  }

  return [];
}
