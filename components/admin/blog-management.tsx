'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type BlogRow = {
  id: string;
  slug: string;
  coverImageKey: string | null;
  category: string | null;
  tags: unknown;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  viewCount: number;
  updatedAt: string;
  titleEn: string | null;
  excerptEn: string | null;
  contentEn: unknown;
  titleHi: string | null;
  excerptHi: string | null;
  contentHi: unknown;
  metaTitleEn: string | null;
  metaDescriptionEn: string | null;
  metaTitleHi: string | null;
  metaDescriptionHi: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  includeInSitemap: boolean;
};

const EMPTY = {
  slug: '',
  coverImageKey: '',
  category: '',
  tags: '',
  status: 'DRAFT' as BlogRow['status'],
  titleEn: '',
  excerptEn: '',
  contentEn: '[]',
  titleHi: '',
  excerptHi: '',
  contentHi: '[]',
  metaTitleEn: '',
  metaDescriptionEn: '',
  metaTitleHi: '',
  metaDescriptionHi: '',
  robotsIndex: true,
  robotsFollow: true,
  includeInSitemap: true,
};

export function BlogManagement({ rows }: { rows: BlogRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(row: BlogRow) {
    setEditingId(row.id);
    setForm({
      slug: row.slug,
      coverImageKey: row.coverImageKey ?? '',
      category: row.category ?? '',
      tags: toStringArray(row.tags).join(', '),
      status: row.status,
      titleEn: row.titleEn ?? '',
      excerptEn: row.excerptEn ?? '',
      contentEn: JSON.stringify(row.contentEn ?? [], null, 2),
      titleHi: row.titleHi ?? '',
      excerptHi: row.excerptHi ?? '',
      contentHi: JSON.stringify(row.contentHi ?? [], null, 2),
      metaTitleEn: row.metaTitleEn ?? '',
      metaDescriptionEn: row.metaDescriptionEn ?? '',
      metaTitleHi: row.metaTitleHi ?? '',
      metaDescriptionHi: row.metaDescriptionHi ?? '',
      robotsIndex: row.robotsIndex,
      robotsFollow: row.robotsFollow,
      includeInSitemap: row.includeInSitemap,
    });
    setError(null);
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const contentEn = JSON.parse(form.contentEn);
      const contentHi = JSON.parse(form.contentHi);
      const response = await fetch(
        '/api/v1/admin/cms/blog' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: form.slug.trim().toLowerCase(),
            coverImageKey: nullable(form.coverImageKey),
            category: nullable(form.category),
            tags: [
              ...new Set(
                form.tags
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean)
              ),
            ],
            status: form.status,
            titleEn: form.titleEn.trim(),
            excerptEn: nullable(form.excerptEn),
            contentEn,
            titleHi: nullable(form.titleHi),
            excerptHi: nullable(form.excerptHi),
            contentHi,
            metaTitleEn: nullable(form.metaTitleEn),
            metaDescriptionEn: nullable(form.metaDescriptionEn),
            metaTitleHi: nullable(form.metaTitleHi),
            metaDescriptionHi: nullable(form.metaDescriptionHi),
            robotsIndex: form.robotsIndex,
            robotsFollow: form.robotsFollow,
            includeInSitemap: form.includeInSitemap,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save blog post.');

      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save blog post.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{editingId ? 'Edit blog post' : 'Create blog post'}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Published posts appear on /blog and /blog/[slug]. Content uses the same safe block
              renderer as CMS pages.
            </p>
          </div>
          {editingId ? (
            <Button type="button" size="sm" variant="secondary" onClick={reset} disabled={busy}>
              Cancel edit
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Input
            required
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
            placeholder="post-slug"
            disabled={busy}
          />
          <Input
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
            placeholder="Category"
            disabled={busy}
          />
          <Input
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            placeholder="Tags, comma separated"
            disabled={busy}
          />
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.status}
            onChange={(event) =>
              setForm({ ...form, status: event.target.value as BlogRow['status'] })
            }
            disabled={busy}
          >
            <option value="DRAFT">DRAFT</option>
            <option value="PUBLISHED">PUBLISHED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>

        <Input
          value={form.coverImageKey}
          onChange={(event) => setForm({ ...form, coverImageKey: event.target.value })}
          placeholder="Cover image object key (optional)"
          disabled={busy}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <BlogLanguageEditor
            label="English"
            required
            title={form.titleEn}
            excerpt={form.excerptEn}
            content={form.contentEn}
            disabled={busy}
            onTitle={(value) => setForm({ ...form, titleEn: value })}
            onExcerpt={(value) => setForm({ ...form, excerptEn: value })}
            onContent={(value) => setForm({ ...form, contentEn: value })}
          />
          <BlogLanguageEditor
            label="Hindi"
            title={form.titleHi}
            excerpt={form.excerptHi}
            content={form.contentHi}
            disabled={busy}
            onTitle={(value) => setForm({ ...form, titleHi: value })}
            onExcerpt={(value) => setForm({ ...form, excerptHi: value })}
            onContent={(value) => setForm({ ...form, contentHi: value })}
          />
        </div>

        <section className="space-y-3 rounded-lg border p-3">
          <p className="font-semibold">SEO</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={form.metaTitleEn}
              onChange={(event) => setForm({ ...form, metaTitleEn: event.target.value })}
              placeholder="English meta title"
              disabled={busy}
            />
            <Input
              value={form.metaTitleHi}
              onChange={(event) => setForm({ ...form, metaTitleHi: event.target.value })}
              placeholder="Hindi meta title"
              disabled={busy}
            />
            <textarea
              className="border-input bg-background min-h-20 rounded-md border p-3 text-sm"
              value={form.metaDescriptionEn}
              onChange={(event) => setForm({ ...form, metaDescriptionEn: event.target.value })}
              placeholder="English meta description"
              disabled={busy}
            />
            <textarea
              className="border-input bg-background min-h-20 rounded-md border p-3 text-sm"
              value={form.metaDescriptionHi}
              onChange={(event) => setForm({ ...form, metaDescriptionHi: event.target.value })}
              placeholder="Hindi meta description"
              disabled={busy}
            />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <Check
              label="Index"
              checked={form.robotsIndex}
              onChange={(value) => setForm({ ...form, robotsIndex: value })}
            />
            <Check
              label="Follow"
              checked={form.robotsFollow}
              onChange={(value) => setForm({ ...form, robotsFollow: value })}
            />
            <Check
              label="Include in sitemap"
              checked={form.includeInSitemap}
              onChange={(value) => setForm({ ...form, includeInSitemap: value })}
            />
          </div>
        </section>

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save blog post'}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Post</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Hindi</th>
              <th className="px-4 py-3">Views</th>
              <th className="px-4 py-3">Published</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{row.titleEn ?? row.slug}</p>
                  <p className="text-muted-foreground mt-1 text-xs">/blog/{row.slug}</p>
                </td>
                <td className="px-4 py-3">{row.category ?? '—'}</td>
                <td className="px-4 py-3">{row.titleHi ? 'YES' : 'MISSING'}</td>
                <td className="px-4 py-3">{row.viewCount}</td>
                <td className="px-4 py-3 text-xs">
                  {row.publishedAt ? new Date(row.publishedAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">{row.status}</td>
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

function BlogLanguageEditor({
  label,
  required = false,
  title,
  excerpt,
  content,
  disabled,
  onTitle,
  onExcerpt,
  onContent,
}: {
  label: string;
  required?: boolean;
  title: string;
  excerpt: string;
  content: string;
  disabled: boolean;
  onTitle: (value: string) => void;
  onExcerpt: (value: string) => void;
  onContent: (value: string) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <p className="font-semibold">{label}</p>
      <Input
        required={required}
        value={title}
        onChange={(event) => onTitle(event.target.value)}
        placeholder={label + ' title'}
        disabled={disabled}
      />
      <textarea
        className="border-input bg-background min-h-20 w-full rounded-md border p-3 text-sm"
        value={excerpt}
        onChange={(event) => onExcerpt(event.target.value)}
        placeholder={label + ' excerpt'}
        disabled={disabled}
      />
      <textarea
        className="border-input bg-background min-h-64 w-full rounded-md border p-3 font-mono text-xs"
        value={content}
        onChange={(event) => onContent(event.target.value)}
        placeholder="Content blocks JSON"
        disabled={disabled}
        spellCheck={false}
      />
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
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function nullable(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
