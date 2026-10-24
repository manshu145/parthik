'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
type Snapshot = {
  summary: Array<{ label: string; value: number }>;
  rows: Array<Record<string, unknown>>;
};
type OperationPermission =
  | 'review:moderate'
  | 'coupon:manage'
  | 'promotion:manage'
  | 'banner:manage'
  | 'template:manage'
  | 'flag:manage'
  | 'admin_user:manage'
  | string;

export function OperationSnapshot({
  snapshot,
  permission,
}: {
  snapshot: Snapshot;
  permission: OperationPermission;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columns = Array.from(new Set(snapshot.rows.flatMap((row) => Object.keys(row)))).slice(0, 9);
  const actionable = new Set<OperationPermission>([
    'review:moderate',
    'coupon:manage',
    'promotion:manage',
    'banner:manage',
    'template:manage',
    'flag:manage',
    'admin_user:manage',
  ]).has(permission);
  async function act(id: string, action: 'enable' | 'disable' | 'approve' | 'reject') {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/operations/${permission}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Operation failed.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operation failed.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4" data-testid="admin-operation-live">
      <div className="grid gap-3 sm:grid-cols-3">
        {snapshot.summary.map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold">{item.value}</p>
              <p className="text-muted-foreground text-xs">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {snapshot.rows.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm">
            No records yet. This module is connected to the production database and ready for
            entries.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="px-3 py-2 font-medium">
                    {column.replaceAll('_', ' ')}
                  </th>
                ))}
                {actionable ? <th className="px-3 py-2">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {snapshot.rows.map((row, index) => {
                const id = String(row.id ?? index);
                const active =
                  row.is_active === true ||
                  row.is_enabled === true ||
                  row.status === 'ACTIVE' ||
                  row.status === 'APPROVED';
                return (
                  <tr key={id}>
                    {columns.map((column) => (
                      <td key={column} className="max-w-64 truncate px-3 py-2">
                        {display(row[column])}
                      </td>
                    ))}
                    {actionable ? (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === id}
                          onClick={() =>
                            void act(
                              id,
                              permission === 'review:moderate'
                                ? 'approve'
                                : active
                                  ? 'disable'
                                  : 'enable'
                            )
                          }
                        >
                          {permission === 'review:moderate'
                            ? 'Approve'
                            : active
                              ? 'Disable'
                              : 'Enable'}
                        </Button>
                        {permission === 'review:moderate' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="ml-2"
                            disabled={busy === id}
                            onClick={() => void act(id, 'reject')}
                          >
                            Reject
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function display(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
