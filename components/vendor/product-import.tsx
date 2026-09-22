'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Option = { id: string; name: string };

export function ProductImport({ stores, categories }: { stores: Option[]; categories: Option[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [csv, setCsv] = useState('name,sku,unit,price,mrp,stock\n');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setResult(null);
    const lines = csv.trim().split(/\r?\n/);
    const headers =
      lines
        .shift()
        ?.split(',')
        .map((item) => item.trim().toLowerCase()) ?? [];
    let created = 0;
    const failures: string[] = [];
    for (const [index, line] of lines.entries()) {
      const values = line.split(',').map((item) => item.trim());
      const row = Object.fromEntries(
        headers.map((header, position) => [header, values[position] ?? ''])
      );
      const payload = {
        name: row.name,
        shortDescription: '',
        description: '',
        storeId,
        categoryId,
        unitLabel: row.unit || '1 pc',
        sku: row.sku,
        pricePaise: Math.round(Number(row.price) * 100),
        mrpPaise: Math.round(Number(row.mrp) * 100),
        quantityAvailable: Number(row.stock),
        lowStockThreshold: 5,
        trackInventory: true,
        allowBackorder: false,
      };
      try {
        const response = await fetch('/api/v1/vendor/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? 'Failed');
        created += 1;
      } catch (caught) {
        failures.push(`Row ${index + 2}: ${caught instanceof Error ? caught.message : 'Failed'}`);
      }
    }
    setResult(
      `${created} products imported.${failures.length ? ` ${failures.length} failed: ${failures.join('; ')}` : ''}`
    );
    setBusy(false);
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>Store</span>
          <select
            className="bg-background h-10 w-full rounded-lg border px-3"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
          >
            {stores.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Category</span>
          <select
            className="bg-background h-10 w-full rounded-lg border px-3"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="space-y-1 text-sm">
        <span>CSV data</span>
        <textarea
          className="bg-background min-h-64 w-full rounded-lg border p-3 font-mono text-xs"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
      </label>
      <p className="text-muted-foreground text-xs">
        Required columns: name, sku, unit, price, mrp, stock. Prices are in rupees.
      </p>
      <Button onClick={() => void submit()} disabled={busy || !storeId || !categoryId}>
        {busy ? 'Importing…' : 'Import products'}
      </Button>
      {result ? (
        <p className="text-sm" role="status">
          {result}
        </p>
      ) : null}
    </div>
  );
}
