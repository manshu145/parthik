'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type BannerRow = {
  id: string;
  placement: 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';
  linkUrl: string | null;
  targetAudience: 'ALL' | 'NEW_USERS' | 'RETURNING' | 'SEGMENT';
  deliveryZoneId: string | null;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  clickCount: number;
  impressionCount: number;
  titleEn: string | null;
  subtitleEn: string | null;
  ctaLabelEn: string | null;
  imageKeyEn: string | null;
  mobileImageKeyEn: string | null;
  titleHi: string | null;
  subtitleHi: string | null;
  ctaLabelHi: string | null;
  imageKeyHi: string | null;
  mobileImageKeyHi: string | null;
};

type BannerForm = {
  placement: 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';
  linkUrl: string;
  targetAudience: 'ALL' | 'NEW_USERS' | 'RETURNING';
  deliveryZoneId: string;
  priority: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  titleEn: string;
  subtitleEn: string;
  ctaLabelEn: string;
  imageKeyEn: string;
  mobileImageKeyEn: string;
  titleHi: string;
  subtitleHi: string;
  ctaLabelHi: string;
  imageKeyHi: string;
  mobileImageKeyHi: string;
};

const EMPTY_BANNER: BannerForm = {
  placement: 'HOME_HERO',
  linkUrl: '',
  targetAudience: 'ALL',
  deliveryZoneId: '',
  priority: '0',
  startsAt: '',
  endsAt: '',
  isActive: true,
  titleEn: '',
  subtitleEn: '',
  ctaLabelEn: '',
  imageKeyEn: '',
  mobileImageKeyEn: '',
  titleHi: '',
  subtitleHi: '',
  ctaLabelHi: '',
  imageKeyHi: '',
  mobileImageKeyHi: '',
};

export function BannerManagement({ rows }: { rows: BannerRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_BANNER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: BannerRow) {
    if (row.targetAudience === 'SEGMENT') {
      setError(
        'This legacy banner uses SEGMENT targeting. Segment targeting is reserved until a segment model is implemented.'
      );
      return;
    }

    setEditingId(row.id);
    setForm({
      placement: row.placement,
      linkUrl: row.linkUrl ?? '',
      targetAudience: row.targetAudience,
      deliveryZoneId: row.deliveryZoneId ?? '',
      priority: String(row.priority),
      startsAt: toDateTimeInput(row.startsAt),
      endsAt: toDateTimeInput(row.endsAt),
      isActive: row.isActive,
      titleEn: row.titleEn ?? '',
      subtitleEn: row.subtitleEn ?? '',
      ctaLabelEn: row.ctaLabelEn ?? '',
      imageKeyEn: row.imageKeyEn ?? '',
      mobileImageKeyEn: row.mobileImageKeyEn ?? '',
      titleHi: row.titleHi ?? '',
      subtitleHi: row.subtitleHi ?? '',
      ctaLabelHi: row.ctaLabelHi ?? '',
      imageKeyHi: row.imageKeyHi ?? '',
      mobileImageKeyHi: row.mobileImageKeyHi ?? '',
    });
    setError(null);
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY_BANNER);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        '/api/v1/admin/marketing/banners' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            placement: form.placement,
            linkUrl: nullable(form.linkUrl),
            targetAudience: form.targetAudience,
            deliveryZoneId: nullable(form.deliveryZoneId),
            priority: integer(form.priority, 'priority'),
            startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
            endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
            isActive: form.isActive,
            titleEn: form.titleEn.trim(),
            subtitleEn: nullable(form.subtitleEn),
            ctaLabelEn: nullable(form.ctaLabelEn),
            imageKeyEn: nullable(form.imageKeyEn),
            mobileImageKeyEn: nullable(form.mobileImageKeyEn),
            titleHi: nullable(form.titleHi),
            subtitleHi: nullable(form.subtitleHi),
            ctaLabelHi: nullable(form.ctaLabelHi),
            imageKeyHi: nullable(form.imageKeyHi),
            mobileImageKeyHi: nullable(form.mobileImageKeyHi),
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save banner.');

      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save banner.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{editingId ? 'Edit banner' : 'Create banner'}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              English is required. Hindi falls back to English. Image fields are stored object
              keys and render when the public asset base URL is configured.
            </p>
          </div>
          {editingId ? (
            <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel edit
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.placement}
            onChange={(event) =>
              setForm({
                ...form,
                placement: event.target.value as typeof form.placement,
              })
            }
            disabled={busy}
          >
            <option value="HOME_HERO">HOME_HERO</option>
            <option value="HOME_STRIP">HOME_STRIP</option>
            <option value="CATEGORY">CATEGORY</option>
            <option value="OFFERS">OFFERS</option>
          </select>

          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.targetAudience}
            onChange={(event) =>
              setForm({
                ...form,
                targetAudience: event.target.value as typeof form.targetAudience,
              })
            }
            disabled={busy}
          >
            <option value="ALL">All customers</option>
            <option value="NEW_USERS">New customers</option>
            <option value="RETURNING">Returning customers</option>
          </select>

          <Input
            type="number"
            step="1"
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}
            placeholder="Priority"
            disabled={busy}
          />

          <Input
            value={form.deliveryZoneId}
            onChange={(event) => setForm({ ...form, deliveryZoneId: event.target.value })}
            placeholder="Zone UUID (optional)"
            disabled={busy}
          />

          <Input
            value={form.linkUrl}
            onChange={(event) => setForm({ ...form, linkUrl: event.target.value })}
            placeholder="/offers or https://..."
            disabled={busy}
          />

          <label className="space-y-1 text-xs">
            <span>Starts at</span>
            <Input
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              disabled={busy}
            />
          </label>

          <label className="space-y-1 text-xs">
            <span>Ends at</span>
            <Input
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              disabled={busy}
            />
          </label>

          <label className="flex items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              disabled={busy}
            />
            Active
          </label>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <BannerLanguageFields
            label="English"
            required
            title={form.titleEn}
            subtitle={form.subtitleEn}
            cta={form.ctaLabelEn}
            imageKey={form.imageKeyEn}
            mobileImageKey={form.mobileImageKeyEn}
            disabled={busy}
            onChange={(patch) => setForm({ ...form, ...patch })}
            suffix="En"
          />
          <BannerLanguageFields
            label="Hindi"
            title={form.titleHi}
            subtitle={form.subtitleHi}
            cta={form.ctaLabelHi}
            imageKey={form.imageKeyHi}
            mobileImageKey={form.mobileImageKeyHi}
            disabled={busy}
            onChange={(patch) => setForm({ ...form, ...patch })}
            suffix="Hi"
          />
        </div>

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save banner'}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Banner</th>
              <th className="px-4 py-3">Placement</th>
              <th className="px-4 py-3">Audience</th>
              <th className="px-4 py-3">Zone</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Schedule</th>
              <th className="px-4 py-3">Stats</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.titleEn ?? 'Untitled'}</p>
                  <p className="text-muted-foreground mt-1 max-w-64 truncate text-xs">
                    {row.linkUrl ?? 'No link'}
                  </p>
                </td>
                <td className="px-4 py-3">{row.placement}</td>
                <td className="px-4 py-3">{row.targetAudience}</td>
                <td className="px-4 py-3">
                  <span className="block max-w-40 truncate">
                    {row.deliveryZoneId ?? 'GLOBAL'}
                  </span>
                </td>
                <td className="px-4 py-3">{row.priority}</td>
                <td className="px-4 py-3 text-xs">
                  <p>{row.startsAt ? new Date(row.startsAt).toLocaleString() : 'Now'}</p>
                  <p>{row.endsAt ? new Date(row.endsAt).toLocaleString() : 'No expiry'}</p>
                </td>
                <td className="px-4 py-3 text-xs">
                  {row.impressionCount} views · {row.clickCount} clicks
                </td>
                <td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}</td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => edit(row)}
                    disabled={row.targetAudience === 'SEGMENT'}
                  >
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

function BannerLanguageFields({
  label,
  required = false,
  title,
  subtitle,
  cta,
  imageKey,
  mobileImageKey,
  disabled,
  onChange,
  suffix,
}: {
  label: string;
  required?: boolean;
  title: string;
  subtitle: string;
  cta: string;
  imageKey: string;
  mobileImageKey: string;
  disabled: boolean;
  onChange: (patch: Record<string, string>) => void;
  suffix: 'En' | 'Hi';
}) {
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold">{label}</p>
      <Input
        required={required}
        value={title}
        onChange={(event) => onChange({ ['title' + suffix]: event.target.value })}
        placeholder={label + ' title'}
        disabled={disabled}
      />
      <Input
        value={subtitle}
        onChange={(event) => onChange({ ['subtitle' + suffix]: event.target.value })}
        placeholder={label + ' subtitle'}
        disabled={disabled}
      />
      <Input
        value={cta}
        onChange={(event) => onChange({ ['ctaLabel' + suffix]: event.target.value })}
        placeholder="CTA label"
        disabled={disabled}
      />
      <Input
        value={imageKey}
        onChange={(event) => onChange({ ['imageKey' + suffix]: event.target.value })}
        placeholder="Desktop image object key"
        disabled={disabled}
      />
      <Input
        value={mobileImageKey}
        onChange={(event) => onChange({ ['mobileImageKey' + suffix]: event.target.value })}
        placeholder="Mobile image object key"
        disabled={disabled}
      />
    </section>
  );
}

type SectionType = 'HERO_BANNERS' | 'FEATURED_CATEGORIES' | 'POPULAR_PRODUCTS' | 'COUPON_STRIP';
type Placement = 'HOME_HERO' | 'HOME_STRIP' | 'CATEGORY' | 'OFFERS';

type Section = {
  type: SectionType;
  title: string | null;
  visible: boolean;
  config: { limit?: number; placement?: Placement };
};

type LayoutRow = {
  id: string;
  name: string;
  isActive: boolean;
  sections: unknown;
  deliveryZoneId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  version: number;
  updatedAt: string;
};

const DEFAULT_SECTIONS: Section[] = [
  {
    type: 'HERO_BANNERS',
    title: null,
    visible: true,
    config: { limit: 4, placement: 'HOME_HERO' },
  },
  { type: 'FEATURED_CATEGORIES', title: null, visible: true, config: { limit: 6 } },
  { type: 'POPULAR_PRODUCTS', title: null, visible: true, config: { limit: 10 } },
  { type: 'COUPON_STRIP', title: null, visible: true, config: { limit: 4 } },
];

export function HomeLayoutManagement({ rows }: { rows: LayoutRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('Default home');
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sections, setSections] = useState<Section[]>(DEFAULT_SECTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCount = useMemo(() => rows.filter((row) => row.isActive).length, [rows]);

  function reset() {
    setEditingId(null);
    setName('Default home');
    setDeliveryZoneId('');
    setValidFrom('');
    setValidUntil('');
    setIsActive(true);
    setSections(DEFAULT_SECTIONS);
    setError(null);
  }

  function edit(row: LayoutRow) {
    setEditingId(row.id);
    setName(row.name);
    setDeliveryZoneId(row.deliveryZoneId ?? '');
    setValidFrom(toDateTimeInput(row.validFrom));
    setValidUntil(toDateTimeInput(row.validUntil));
    setIsActive(row.isActive);
    setSections(normaliseSections(row.sections));
    setError(null);
  }

  function patchSection(index: number, patch: Partial<Section>) {
    setSections((current) =>
      current.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, ...patch } : section
      )
    );
  }

  function patchConfig(index: number, patch: Partial<Section['config']>) {
    setSections((current) =>
      current.map((section, sectionIndex) =>
        sectionIndex === index
          ? { ...section, config: { ...section.config, ...patch } }
          : section
      )
    );
  }

  function move(index: number, direction: -1 | 1) {
    setSections((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const item = next[index]!;
      next[index] = next[target]!;
      next[target] = item;
      return next;
    });
  }

  function addSection() {
    setSections((current) => [
      ...current,
      { type: 'FEATURED_CATEGORIES', title: null, visible: true, config: { limit: 6 } },
    ]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        '/api/v1/admin/cms/home-layouts' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            isActive,
            deliveryZoneId: nullable(deliveryZoneId),
            validFrom: validFrom ? new Date(validFrom).toISOString() : null,
            validUntil: validUntil ? new Date(validUntil).toISOString() : null,
            sections,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? 'Could not save homepage layout.');
      }

      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save homepage layout.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              {editingId ? 'Edit homepage layout' : 'Create homepage layout'}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Active zone-specific layouts override the active global layout. Activating a new
              layout automatically deactivates the previous layout for the same zone.
            </p>
          </div>
          <p className="text-muted-foreground text-xs">{activeCount} active layout(s)</p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Layout name"
            disabled={busy}
          />
          <Input
            value={deliveryZoneId}
            onChange={(event) => setDeliveryZoneId(event.target.value)}
            placeholder="Zone UUID (blank = global)"
            disabled={busy}
          />
          <label className="space-y-1 text-xs">
            <span>Valid from</span>
            <Input
              type="datetime-local"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span>Valid until</span>
            <Input
              type="datetime-local"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={busy}
          />
          Active
        </label>

        <div className="space-y-2">
          {sections.map((section, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-lg border p-3 md:grid-cols-[180px_1fr_100px_170px_auto]"
            >
              <select
                className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                value={section.type}
                onChange={(event) =>
                  patchSection(index, { type: event.target.value as SectionType })
                }
                disabled={busy}
              >
                <option value="HERO_BANNERS">Hero banners</option>
                <option value="FEATURED_CATEGORIES">Featured categories</option>
                <option value="POPULAR_PRODUCTS">Popular products</option>
                <option value="COUPON_STRIP">Coupon strip</option>
              </select>

              <Input
                value={section.title ?? ''}
                onChange={(event) =>
                  patchSection(index, { title: event.target.value.trim() || null })
                }
                placeholder="Optional section title override"
                disabled={busy}
              />

              <Input
                type="number"
                min="1"
                max="24"
                value={section.config.limit ?? 6}
                onChange={(event) =>
                  patchConfig(index, {
                    limit: Math.min(24, Math.max(1, Number(event.target.value) || 1)),
                  })
                }
                disabled={busy}
              />

              {section.type === 'HERO_BANNERS' ? (
                <select
                  className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                  value={section.config.placement ?? 'HOME_HERO'}
                  onChange={(event) =>
                    patchConfig(index, { placement: event.target.value as Placement })
                  }
                  disabled={busy}
                >
                  <option value="HOME_HERO">HOME_HERO</option>
                  <option value="HOME_STRIP">HOME_STRIP</option>
                  <option value="CATEGORY">CATEGORY</option>
                  <option value="OFFERS">OFFERS</option>
                </select>
              ) : (
                <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={section.visible}
                    onChange={(event) =>
                      patchSection(index, { visible: event.target.checked })
                    }
                    disabled={busy}
                  />
                  Visible
                </label>
              )}

              <div className="flex gap-1">
                {section.type === 'HERO_BANNERS' ? (
                  <label className="flex h-10 items-center gap-2 rounded-md border px-2 text-xs">
                    <input
                      type="checkbox"
                      checked={section.visible}
                      onChange={(event) =>
                        patchSection(index, { visible: event.target.checked })
                      }
                      disabled={busy}
                    />
                    Visible
                  </label>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => move(index, 1)}
                  disabled={busy || index === sections.length - 1}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  disabled={busy || sections.length === 1}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button type="button" variant="secondary" size="sm" onClick={addSection} disabled={busy}>
          Add section
        </Button>

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save homepage layout'}
          </Button>
          {editingId ? (
            <Button type="button" variant="secondary" onClick={reset} disabled={busy}>
              Cancel edit
            </Button>
          ) : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Layout</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Sections</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Validity</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3">
                  <span className="block max-w-48 truncate">
                    {row.deliveryZoneId ?? 'GLOBAL'}
                  </span>
                </td>
                <td className="px-4 py-3">{normaliseSections(row.sections).length}</td>
                <td className="px-4 py-3">v{row.version}</td>
                <td className="px-4 py-3 text-xs">
                  <p>{row.validFrom ? new Date(row.validFrom).toLocaleString() : 'Always'}</p>
                  <p>{row.validUntil ? new Date(row.validUntil).toLocaleString() : 'No expiry'}</p>
                </td>
                <td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}</td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => edit(row)}>
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

function normaliseSections(value: unknown): Section[] {
  if (!Array.isArray(value)) return DEFAULT_SECTIONS;

  const allowedTypes = new Set<SectionType>([
    'HERO_BANNERS',
    'FEATURED_CATEGORIES',
    'POPULAR_PRODUCTS',
    'COUPON_STRIP',
  ]);
  const allowedPlacements = new Set<Placement>([
    'HOME_HERO',
    'HOME_STRIP',
    'CATEGORY',
    'OFFERS',
  ]);

  const result: Section[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.type !== 'string' || !allowedTypes.has(row.type as SectionType)) continue;

    const rawConfig =
      row.config && typeof row.config === 'object'
        ? (row.config as Record<string, unknown>)
        : {};
    const limit =
      typeof rawConfig.limit === 'number' && Number.isInteger(rawConfig.limit)
        ? Math.min(24, Math.max(1, rawConfig.limit))
        : 6;
    const placement =
      typeof rawConfig.placement === 'string' &&
      allowedPlacements.has(rawConfig.placement as Placement)
        ? (rawConfig.placement as Placement)
        : undefined;

    result.push({
      type: row.type as SectionType,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
      visible: row.visible !== false,
      config: {
        limit,
        ...(placement ? { placement } : {}),
      },
    });
  }

  return result.length ? result : DEFAULT_SECTIONS;
}

function nullable(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function integer(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error('Enter a valid ' + label + '.');
  return number;
}

function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}
