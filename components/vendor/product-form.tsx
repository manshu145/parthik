'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Option {
  id: string;
  name: string;
}

interface ProductFormInitial {
  id: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  storeId: string;
  categoryId: string;
  unitLabel: string | null;
  sku: string | null;
  pricePaise: number;
  mrpPaise: number;
  quantityAvailable: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  allowBackorder: boolean;
  version: number;
}

export function VendorProductForm({
  locale,
  stores,
  categories,
  initial,
}: {
  locale: string;
  stores: Option[];
  categories: Option[];
  initial?: ProductFormInitial;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get('name') ?? ''),
      shortDescription: String(data.get('shortDescription') ?? ''),
      description: String(data.get('description') ?? ''),
      storeId: String(data.get('storeId') ?? ''),
      categoryId: String(data.get('categoryId') ?? ''),
      unitLabel: String(data.get('unitLabel') ?? ''),
      sku: String(data.get('sku') ?? ''),
      pricePaise: Math.round(Number(data.get('priceRupees') ?? 0) * 100),
      mrpPaise: Math.round(Number(data.get('mrpRupees') ?? 0) * 100),
      quantityAvailable: Number(data.get('quantityAvailable') ?? 0),
      lowStockThreshold: Number(data.get('lowStockThreshold') ?? 0),
      trackInventory: data.get('trackInventory') === 'on',
      allowBackorder: data.get('allowBackorder') === 'on',
      ...(initial ? { version: initial.version } : {}),
    };

    try {
      const response = await fetch(
        initial ? `/api/v1/vendor/products/${initial.id}` : '/api/v1/vendor/products',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const body = (await response.json()) as {
        success: boolean;
        data?: { id?: string };
        error?: { message?: string };
      };

      if (!response.ok || !body.success) {
        setError(body.error?.message ?? 'Could not save the product.');
        return;
      }

      if (!initial && body.data?.id) {
        router.push(`/${locale}/vendor/products/${body.data.id}/edit`);
        return;
      }

      setMessage(locale === 'hi' ? 'Product save हो गया।' : 'Product saved.');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6" data-testid="vendor-product-form">
      <section className="grid gap-4 rounded-xl border p-4">
        <div>
          <h2 className="font-semibold">{locale === 'hi' ? 'मूल जानकारी' : 'Basic information'}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {locale === 'hi'
              ? 'Product draft के रूप में save होगा। Approval/publishing अलग permission से नियंत्रित है।'
              : 'New products are saved as drafts. Approval and publishing stay behind separate permissions.'}
          </p>
        </div>

        <Field label="Product name">
          <Input name="name" required minLength={2} maxLength={160} defaultValue={initial?.name ?? ''} />
        </Field>

        <Field label="Short description">
          <Input
            name="shortDescription"
            maxLength={320}
            defaultValue={initial?.shortDescription ?? ''}
          />
        </Field>

        <Field label="Description">
          <textarea
            name="description"
            rows={5}
            maxLength={5000}
            defaultValue={initial?.description ?? ''}
            className="border-input bg-background min-h-28 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          />
        </Field>
      </section>

      <section className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
        <Field label="Store">
          <select
            name="storeId"
            required
            defaultValue={initial?.storeId ?? stores[0]?.id ?? ''}
            className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <select
            name="categoryId"
            required
            defaultValue={initial?.categoryId ?? categories[0]?.id ?? ''}
            className="border-input bg-background h-10 w-full rounded-lg border px-3 text-sm"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Unit label">
          <Input name="unitLabel" required maxLength={60} defaultValue={initial?.unitLabel ?? ''} placeholder="500 g" />
        </Field>

        <Field label="SKU">
          <Input name="sku" maxLength={80} defaultValue={initial?.sku ?? ''} />
        </Field>
      </section>

      <section className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Selling price (₹)">
          <Input
            name="priceRupees"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={initial ? (initial.pricePaise / 100).toFixed(2) : ''}
          />
        </Field>

        <Field label="MRP (₹)">
          <Input
            name="mrpRupees"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={initial ? (initial.mrpPaise / 100).toFixed(2) : ''}
          />
        </Field>

        <Field label="Available stock">
          <Input
            name="quantityAvailable"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={initial?.quantityAvailable ?? 0}
          />
        </Field>

        <Field label="Low-stock threshold">
          <Input
            name="lowStockThreshold"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={initial?.lowStockThreshold ?? 0}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            name="trackInventory"
            type="checkbox"
            defaultChecked={initial?.trackInventory ?? true}
          />
          Track inventory
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            name="allowBackorder"
            type="checkbox"
            defaultChecked={initial?.allowBackorder ?? false}
          />
          Allow backorder
        </label>
      </section>

      {stores.length === 0 || categories.length === 0 ? (
        <p className="text-danger text-sm">
          A store and at least one active category are required before products can be saved.
        </p>
      ) : null}
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {message ? <p className="text-success text-sm">{message}</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={saving || stores.length === 0 || categories.length === 0}>
          {saving
            ? locale === 'hi'
              ? 'Save हो रहा है…'
              : 'Saving…'
            : initial
              ? locale === 'hi'
                ? 'Changes save करें'
                : 'Save changes'
              : locale === 'hi'
                ? 'Product बनाएं'
                : 'Create product'}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
