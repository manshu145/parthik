'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CmsPageRow = {
  id: string;
  slug: string;
  pageType: string;
  status: string;
  version: number;
  titleEn: string | null;
  titleHi: string | null;
};

const EMPTY_PAGE = {
  slug: 'about',
  pageType: 'INFO',
  status: 'DRAFT',
  titleEn: '',
  titleHi: '',
  contentEn: '[]',
  contentHi: '[]',
  metaTitleEn: '',
  metaDescriptionEn: '',
  metaTitleHi: '',
  metaDescriptionHi: '',
  robotsIndex: true,
  robotsFollow: true,
  includeInSitemap: true,
};

export function CmsPageManager({
  rows,
  slugs,
}: {
  rows: CmsPageRow[];
  slugs: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = pagePayload(form);
      const response = await fetch('/api/v1/admin/cms/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not create CMS page.');
      setForm(EMPTY_PAGE);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create CMS page.');
    } finally {
      setBusy(false);
    }
  }

  const existing = new Set(rows.map((row) => row.slug));
  const availableSlugs = slugs.filter((slug) => !existing.has(slug));

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <form onSubmit={create} className="space-y-3 rounded-xl border p-4">
        <div>
          <p className="font-semibold">Create CMS page</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Public route slugs are restricted to the supported marketing/legal pages.
          </p>
        </div>

        <select
          className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          value={form.slug}
          onChange={(event) => setForm({ ...form, slug: event.target.value })}
          disabled={busy || availableSlugs.length === 0}
        >
          {(availableSlugs.length ? availableSlugs : slugs).map((slug) => (
            <option key={slug} value={slug}>
              /{slug}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.pageType}
            onChange={(event) => setForm({ ...form, pageType: event.target.value })}
            disabled={busy}
          >
            <option value="INFO">INFO</option>
            <option value="LEGAL">LEGAL</option>
            <option value="LANDING">LANDING</option>
          </select>
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
            disabled={busy}
          >
            <option value="DRAFT">DRAFT</option>
            <option value="PUBLISHED">PUBLISHED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>

        <Input
          required
          value={form.titleEn}
          onChange={(event) => setForm({ ...form, titleEn: event.target.value })}
          placeholder="English title"
          disabled={busy}
        />
        <Input
          value={form.titleHi}
          onChange={(event) => setForm({ ...form, titleHi: event.target.value })}
          placeholder="Hindi title (optional)"
          disabled={busy}
        />

        <p className="text-muted-foreground text-xs">
          Detailed content and SEO can be edited immediately after creation.
        </p>

        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <Button type="submit" size="sm" disabled={busy || availableSlugs.length === 0}>
          {busy ? 'Creating…' : availableSlugs.length ? 'Create page' : 'All routes already exist'}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Page</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Hindi</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.titleEn ?? row.slug}</p>
                  <p className="text-muted-foreground mt-1 text-xs">/{row.slug}</p>
                </td>
                <td className="px-4 py-3">{row.pageType}</td>
                <td className="px-4 py-3">{row.status}</td>
                <td className="px-4 py-3">{row.titleHi ? 'YES' : 'MISSING'}</td>
                <td className="px-4 py-3">{row.version}</td>
                <td className="px-4 py-3">
                  <Link
                    className="border-input hover:bg-muted inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium"
                    href={'/admin/cms/pages/' + row.id}
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type CmsPageDetail = {
  id: string;
  slug: string;
  pageType: string;
  status: string;
  version: number;
  titleEn: string;
  titleHi: string | null;
  contentEn: unknown;
  contentHi: unknown;
  metaTitleEn: string | null;
  metaDescriptionEn: string | null;
  metaTitleHi: string | null;
  metaDescriptionHi: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  includeInSitemap: boolean;
};

export function CmsPageEditor({ page }: { page: CmsPageDetail }) {
  const router = useRouter();
  const [form, setForm] = useState({
    slug: page.slug,
    pageType: page.pageType,
    status: page.status,
    titleEn: page.titleEn,
    titleHi: page.titleHi ?? '',
    contentEn: JSON.stringify(page.contentEn ?? [], null, 2),
    contentHi: JSON.stringify(page.contentHi ?? [], null, 2),
    metaTitleEn: page.metaTitleEn ?? '',
    metaDescriptionEn: page.metaDescriptionEn ?? '',
    metaTitleHi: page.metaTitleHi ?? '',
    metaDescriptionHi: page.metaDescriptionHi ?? '',
    robotsIndex: page.robotsIndex,
    robotsFollow: page.robotsFollow,
    includeInSitemap: page.includeInSitemap,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/v1/admin/cms/pages/' + page.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pagePayload(form)),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save CMS page.');
      setMessage('CMS page saved. Published changes are available on new requests.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save CMS page.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <section className="space-y-3 rounded-xl border p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span>Slug</span>
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} disabled={busy} />
          </label>
          <label className="space-y-1 text-sm">
            <span>Page type</span>
            <select className="border-input bg-background h-10 w-full rounded-md border px-3" value={form.pageType} onChange={(e) => setForm({ ...form, pageType: e.target.value })} disabled={busy}>
              <option value="INFO">INFO</option>
              <option value="LEGAL">LEGAL</option>
              <option value="LANDING">LANDING</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Status</span>
            <select className="border-input bg-background h-10 w-full rounded-md border px-3" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={busy}>
              <option value="DRAFT">DRAFT</option>
              <option value="PUBLISHED">PUBLISHED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
        </div>
        <p className="text-muted-foreground text-xs">Current version: {page.version}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <LanguageEditor
          label="English"
          title={form.titleEn}
          content={form.contentEn}
          onTitle={(value) => setForm({ ...form, titleEn: value })}
          onContent={(value) => setForm({ ...form, contentEn: value })}
          required
        />
        <LanguageEditor
          label="Hindi"
          title={form.titleHi}
          content={form.contentHi}
          onTitle={(value) => setForm({ ...form, titleHi: value })}
          onContent={(value) => setForm({ ...form, contentHi: value })}
        />
      </div>

      <section className="space-y-4 rounded-xl border p-4">
        <div>
          <p className="font-semibold">SEO</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Metadata is stored per locale. Robots and sitemap directives are language-neutral.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Input value={form.metaTitleEn} onChange={(e) => setForm({ ...form, metaTitleEn: e.target.value })} placeholder="English meta title" disabled={busy} />
          <Input value={form.metaTitleHi} onChange={(e) => setForm({ ...form, metaTitleHi: e.target.value })} placeholder="Hindi meta title" disabled={busy} />
          <textarea className="border-input bg-background min-h-20 rounded-md border p-3 text-sm" value={form.metaDescriptionEn} onChange={(e) => setForm({ ...form, metaDescriptionEn: e.target.value })} placeholder="English meta description" disabled={busy} />
          <textarea className="border-input bg-background min-h-20 rounded-md border p-3 text-sm" value={form.metaDescriptionHi} onChange={(e) => setForm({ ...form, metaDescriptionHi: e.target.value })} placeholder="Hindi meta description" disabled={busy} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <Check label="Index" checked={form.robotsIndex} onChange={(value) => setForm({ ...form, robotsIndex: value })} />
          <Check label="Follow" checked={form.robotsFollow} onChange={(value) => setForm({ ...form, robotsFollow: value })} />
          <Check label="Include in sitemap" checked={form.includeInSitemap} onChange={(value) => setForm({ ...form, includeInSitemap: value })} />
        </div>
      </section>

      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {message ? <p className="text-success text-sm">{message}</p> : null}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save CMS page'}</Button>
    </form>
  );
}

function LanguageEditor({
  label,
  title,
  content,
  onTitle,
  onContent,
  required = false,
}: {
  label: string;
  title: string;
  content: string;
  onTitle: (value: string) => void;
  onContent: (value: string) => void;
  required?: boolean;
}) {
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <p className="font-semibold">{label}</p>
      <Input required={required} value={title} onChange={(e) => onTitle(e.target.value)} placeholder={label + ' title'} />
      <label className="block space-y-1 text-sm">
        <span>Content blocks (JSON)</span>
        <textarea
          className="border-input bg-background min-h-72 w-full rounded-md border p-3 font-mono text-xs"
          value={content}
          onChange={(e) => onContent(e.target.value)}
          spellCheck={false}
        />
      </label>
      <p className="text-muted-foreground text-xs">
        Supported blocks: heading, paragraph and list. Invalid JSON is rejected before saving.
      </p>
    </section>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function pagePayload(form: typeof EMPTY_PAGE | Record<string, string | boolean>) {
  let contentEn: unknown;
  let contentHi: unknown;
  try {
    contentEn = JSON.parse(String(form.contentEn));
    contentHi = JSON.parse(String(form.contentHi));
  } catch {
    throw new Error('Content blocks must be valid JSON.');
  }

  return {
    slug: String(form.slug).trim(),
    pageType: String(form.pageType),
    status: String(form.status),
    titleEn: String(form.titleEn).trim(),
    titleHi: String(form.titleHi).trim() || null,
    contentEn,
    contentHi,
    metaTitleEn: String(form.metaTitleEn).trim() || null,
    metaDescriptionEn: String(form.metaDescriptionEn).trim() || null,
    metaTitleHi: String(form.metaTitleHi).trim() || null,
    metaDescriptionHi: String(form.metaDescriptionHi).trim() || null,
    robotsIndex: Boolean(form.robotsIndex),
    robotsFollow: Boolean(form.robotsFollow),
    includeInSitemap: Boolean(form.includeInSitemap),
  };
}

type RedirectRow = {
  id: string;
  sourcePath: string;
  targetPath: string;
  statusCode: number;
  isActive: boolean;
  hitCount: number;
  note: string | null;
};

export function RedirectManager({ rows }: { rows: RedirectRow[] }) {
  const router = useRouter();
  const empty = { sourcePath: '', targetPath: '', statusCode: '301', isActive: true, note: '' };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: RedirectRow) {
    setEditingId(row.id);
    setForm({
      sourcePath: row.sourcePath,
      targetPath: row.targetPath,
      statusCode: String(row.statusCode),
      isActive: row.isActive,
      note: row.note ?? '',
    });
    setError(null);
  }

  function reset() {
    setEditingId(null);
    setForm(empty);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/v1/admin/cms/redirects' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourcePath: form.sourcePath.trim(),
            targetPath: form.targetPath.trim(),
            statusCode: Number(form.statusCode),
            isActive: form.isActive,
            note: form.note.trim() || null,
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save redirect.');
      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save redirect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[390px_1fr]">
      <form onSubmit={save} className="space-y-3 rounded-xl border p-4">
        <p className="font-semibold">{editingId ? 'Edit redirect' : 'Create redirect'}</p>
        <Input required value={form.sourcePath} onChange={(e) => setForm({ ...form, sourcePath: e.target.value })} placeholder="/old-path" disabled={busy} />
        <Input required value={form.targetPath} onChange={(e) => setForm({ ...form, targetPath: e.target.value })} placeholder="/new-path" disabled={busy} />
        <select className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm" value={form.statusCode} onChange={(e) => setForm({ ...form, statusCode: e.target.value })} disabled={busy}>
          <option value="301">301 Permanent</option>
          <option value="302">302 Temporary</option>
        </select>
        <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Internal note (optional)" disabled={busy} />
        <Check label="Active" checked={form.isActive} onChange={(value) => setForm({ ...form, isActive: value })} />
        {error ? <p className="text-danger text-sm">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save redirect'}</Button>
          {editingId ? <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>Cancel</Button> : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr><th className="px-4 py-3">Source</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Code</th><th className="px-4 py-3">Hits</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium">{row.sourcePath}</td>
                <td className="px-4 py-3">{row.targetPath}</td>
                <td className="px-4 py-3">{row.statusCode}</td>
                <td className="px-4 py-3">{row.hitCount}</td>
                <td className="px-4 py-3">{row.isActive ? 'ACTIVE' : 'INACTIVE'}</td>
                <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => edit(row)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
