'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Permission = {
  id: string;
  key: string;
  resource: string;
  action: string;
  description: string | null;
};

type Role = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissionKeys: string[];
  editable: boolean;
  wildcard: boolean;
};

export function RoleManagement({
  roles,
  permissions,
}: {
  roles: Role[];
  permissions: Permission[];
}) {
  const router = useRouter();
  const [selectedRoleId, setSelectedRoleId] = useState(
    roles.find((role) => role.editable)?.id ?? roles[0]?.id ?? ''
  );
  const selected = roles.find((role) => role.id === selectedRoleId) ?? null;
  const [draft, setDraft] = useState<string[]>(selected?.permissionKeys ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const permission of permissions) {
      const group = map.get(permission.resource) ?? [];
      group.push(permission);
      map.set(permission.resource, group);
    }
    return [...map.entries()];
  }, [permissions]);

  function choose(role: Role) {
    setSelectedRoleId(role.id);
    setDraft(role.permissionKeys);
    setMessage(null);
    setError(null);
  }

  function toggle(key: string) {
    setDraft((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  async function save() {
    if (!selected?.editable) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/access/roles/' + selected.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionKeys: draft }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Role update failed.');
      setMessage('Role permissions updated. New requests use this permission set immediately.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Role update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => choose(role)}
            className={
              'w-full rounded-xl border p-3 text-left text-sm ' +
              (role.id === selectedRoleId ? 'bg-muted' : 'hover:bg-muted/50')
            }
          >
            <p className="font-semibold">{role.name}</p>
            <p className="text-muted-foreground mt-1 text-xs">{role.key}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {role.wildcard
                ? 'All permissions (protected)'
                : role.editable
                  ? role.permissionKeys.length + ' permissions'
                  : 'Protected core role'}
            </p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border p-4">
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {selected.description ?? selected.key}
                </p>
              </div>
              {!selected.editable ? (
                <span className="text-muted-foreground text-xs">
                  {selected.wildcard ? 'Wildcard role · protected' : 'Core role · protected'}
                </span>
              ) : null}
            </div>

            {selected.wildcard ? (
              <p className="mt-4 rounded-lg border p-3 text-sm">
                SUPER_ADMIN always receives every permission and cannot be reduced from this
                screen.
              </p>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {grouped.map(([resource, items]) => (
                  <fieldset key={resource} className="rounded-lg border p-3">
                    <legend className="px-1 text-sm font-semibold">{resource}</legend>
                    <div className="mt-2 space-y-2">
                      {items.map((permission) => (
                        <label key={permission.id} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={
                              selected.editable
                                ? draft.includes(permission.key)
                                : selected.permissionKeys.includes(permission.key)
                            }
                            onChange={() => toggle(permission.key)}
                            disabled={!selected.editable || busy}
                          />
                          <span>
                            <span className="font-medium">{permission.key}</span>
                            {permission.description ? (
                              <span className="text-muted-foreground block text-xs">
                                {permission.description}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}

            {error ? <p className="text-danger mt-3 text-sm">{error}</p> : null}
            {message ? <p className="text-success mt-3 text-sm">{message}</p> : null}
            {selected.editable ? (
              <Button className="mt-4" size="sm" disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save permissions'}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No roles found.</p>
        )}
      </div>
    </div>
  );
}

const ADMIN_ROLES = [
  'ADMIN',
  'ADMIN_SUPPORT',
  'ADMIN_OPS',
  'ADMIN_FINANCE',
  'SUPER_ADMIN',
] as const;

type AdminUser = {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  roles: string[];
  adminRoleKeys: string[];
  createdAt: string;
  lastLoginAt: string | null;
};

export function AdminUserManagement({ users }: { users: AdminUser[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const filtered = users.filter((user) => {
    const haystack = [user.fullName, user.phone, user.email, ...user.roles]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, phone, email or role"
      />
      <div className="space-y-3">
        {filtered.map((user) => (
          <AdminUserRow key={user.id} user={user} onSaved={() => router.refresh()} />
        ))}
        {filtered.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border p-4 text-sm">No users found.</p>
        ) : null}
      </div>
    </div>
  );
}

function AdminUserRow({ user, onSaved }: { user: AdminUser; onSaved: () => void }) {
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED'>(
    user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'
  );
  const [roles, setRoles] = useState<string[]>(user.adminRoleKeys);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function toggleRole(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role]
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/v1/admin/access/users/' + user.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminRoleKeys: roles }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'User access update failed.');
      setMessage('Access updated. Existing sessions for this user were revoked.');
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'User access update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{user.fullName ?? user.phone ?? user.email ?? user.id}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {[user.phone, user.email].filter(Boolean).join(' · ') || 'No contact details'}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {user.roles.length ? user.roles.join(', ') : 'No active roles'} · {user.status}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Close' : 'Manage'}
        </Button>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 border-t pt-4">
          <label className="block space-y-1 text-sm">
            <span>Status</span>
            <select
              className="border-input bg-background h-10 w-full max-w-xs rounded-md border px-3"
              value={status}
              onChange={(event) => setStatus(event.target.value as 'ACTIVE' | 'SUSPENDED')}
              disabled={busy}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>

          <div>
            <p className="text-sm font-medium">Global admin roles</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {ADMIN_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    disabled={busy}
                  />
                  {role}
                </label>
              ))}
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            Customer/vendor/driver scoped roles are preserved and are not changed here.
          </p>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          {message ? <p className="text-success text-sm">{message}</p> : null}
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save access'}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

type Flag = {
  id: string;
  key: string;
  description: string | null;
  isEnabled: boolean;
  rolloutPercentage: number;
  enabledForRoles: string[];
  enabledForZones: string[];
};

type Zone = { id: string; name: string; code: string };

export function FeatureFlagManagement({
  flags,
  zones,
}: {
  flags: Flag[];
  zones: Zone[];
}) {
  const router = useRouter();
  const empty = {
    key: '',
    description: '',
    isEnabled: false,
    rolloutPercentage: '0',
    enabledForRoles: [] as string[],
    enabledForZones: [] as string[],
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(flag: Flag) {
    setEditingId(flag.id);
    setForm({
      key: flag.key,
      description: flag.description ?? '',
      isEnabled: flag.isEnabled,
      rolloutPercentage: String(flag.rolloutPercentage),
      enabledForRoles: flag.enabledForRoles,
      enabledForZones: flag.enabledForZones,
    });
    setError(null);
  }

  function reset() {
    setEditingId(null);
    setForm(empty);
    setError(null);
  }

  function toggleArray(field: 'enabledForRoles' | 'enabledForZones', value: string) {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/v1/admin/feature-flags' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(editingId ? {} : { key: form.key.trim() }),
            description: form.description.trim() || null,
            isEnabled: form.isEnabled,
            rolloutPercentage: Number(form.rolloutPercentage),
            enabledForRoles: form.enabledForRoles,
            enabledForZones: form.enabledForZones,
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Feature flag save failed.');
      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Feature flag save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
      <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
        <p className="font-semibold">{editingId ? 'Edit feature flag' : 'Create feature flag'}</p>
        <Input
          required
          disabled={busy || editingId !== null}
          value={form.key}
          onChange={(event) => setForm({ ...form, key: event.target.value })}
          placeholder="flag.key"
        />
        <textarea
          className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="Description"
          disabled={busy}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(event) => setForm({ ...form, isEnabled: event.target.checked })}
            disabled={busy}
          />
          Enabled
        </label>
        <label className="space-y-1 text-sm">
          <span>Rollout percentage</span>
          <Input
            type="number"
            min="0"
            max="100"
            value={form.rolloutPercentage}
            onChange={(event) => setForm({ ...form, rolloutPercentage: event.target.value })}
            disabled={busy}
          />
        </label>

        <div>
          <p className="text-sm font-medium">Roles (empty = all roles)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {['CUSTOMER', 'VENDOR_OWNER', 'VENDOR_STAFF', 'DRIVER', ...ADMIN_ROLES].map((role) => (
              <label key={role} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={form.enabledForRoles.includes(role)}
                  onChange={() => toggleArray('enabledForRoles', role)}
                  disabled={busy}
                />
                {role}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Zones (empty = all zones)</p>
          <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-lg border p-2">
            {zones.map((zone) => (
              <label key={zone.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.enabledForZones.includes(zone.id)}
                  onChange={() => toggleArray('enabledForZones', zone.id)}
                  disabled={busy}
                />
                {zone.name} ({zone.code})
              </label>
            ))}
          </div>
        </div>

        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Save flag'}
          </Button>
          {editingId ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Rollout</th>
              <th className="px-4 py-3">Role targets</th>
              <th className="px-4 py-3">Zone targets</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {flags.map((flag) => (
              <tr key={flag.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{flag.key}</p>
                  <p className="text-muted-foreground mt-1 max-w-72 text-xs">
                    {flag.description ?? '—'}
                  </p>
                </td>
                <td className="px-4 py-3">{flag.isEnabled ? 'YES' : 'NO'}</td>
                <td className="px-4 py-3">{flag.rolloutPercentage}%</td>
                <td className="px-4 py-3 text-xs">
                  {flag.enabledForRoles.length ? flag.enabledForRoles.join(', ') : 'All'}
                </td>
                <td className="px-4 py-3 text-xs">
                  {flag.enabledForZones.length ? flag.enabledForZones.length + ' zones' : 'All'}
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => edit(flag)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
