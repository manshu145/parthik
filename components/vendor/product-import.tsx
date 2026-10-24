'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { parseCsvRecords } from '@/lib/csv/parse-csv-records';

type Option = { id: string; name: string };
type ProductPayload = {
  name: string;
  shortDescription: string;
  description: string;
  storeId: string;
  categoryId: string;
  unitLabel: string;
  sku: string;
  pricePaise: number;
  mrpPaise: number;
  quantityAvailable: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  allowBackorder: boolean;
};

const REQUIRED_HEADERS = ['name', 'sku', 'price', 'mrp', 'stock'];
const ALLOWED_HEADERS = new Set([...REQUIRED_HEADERS, 'unit']);
const MAX_IMPORT_ROWS = 100;

function parseRupeesToPaise(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) return null;
  const paise = Math.round(amount * 100);
  return Number.isSafeInteger(paise) ? paise : null;
}

export function ProductImport({
  stores,
  categories,
  locale,
}: {
  stores: Option[];
  categories: Option[];
  locale: string;
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [csv, setCsv] = useState('name,sku,unit,price,mrp,stock\n');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const isHindi = locale === 'hi';
  const copy = isHindi
    ? {
        store: 'स्टोर',
        category: 'श्रेणी',
        csv: 'CSV डेटा',
        required:
          'ज़रूरी कॉलम: name, sku, price, mrp, stock. unit वैकल्पिक है। कीमत रुपये में दें; quoted fields में comma इस्तेमाल कर सकते हैं।',
        limit: 'एक बार में अधिकतम 100 products import करें।',
        import: 'Products import करें',
        importing: 'Import हो रहा है…',
        noStores: 'Import करने से पहले स्टोर और श्रेणी उपलब्ध होने चाहिए।',
        noRows: 'CSV में header के बाद कम-से-कम एक product row होनी चाहिए।',
        tooMany: 'एक बार में अधिकतम 100 product rows import हो सकती हैं।',
        invalidHeader: 'CSV header में required columns जोड़ें और unknown/duplicate columns हटाएँ।',
        validation: 'CSV में गलत rows मिलीं। कोई product request नहीं भेजी गई:',
        imported: 'products import हुए।',
        failed: 'rows import नहीं हो सकीं:',
      }
    : {
        store: 'Store',
        category: 'Category',
        csv: 'CSV data',
        required:
          'Required columns: name, sku, price, mrp, stock. unit is optional. Use rupee amounts; commas inside quoted fields are supported.',
        limit: 'Import up to 100 products per batch.',
        import: 'Import products',
        importing: 'Importing…',
        noStores: 'A store and category must be available before importing.',
        noRows: 'Add at least one product row after the CSV header.',
        tooMany: 'A batch can contain at most 100 product rows.',
        invalidHeader: 'Add the required CSV columns and remove unknown or duplicate columns.',
        validation: 'Invalid CSV rows. No product requests were sent:',
        imported: 'products imported.',
        failed: 'rows failed:',
      };

  async function submit() {
    if (busy) return;
    setBusy(true);
    setResult(null);

    try {
      if (
        !stores.some((item) => item.id === storeId) ||
        !categories.some((item) => item.id === categoryId)
      ) {
        setResult({ kind: 'error', text: copy.noStores });
        return;
      }

      const parsed = parseCsvRecords(csv);
      if (!parsed.success) {
        setResult({ kind: 'error', text: parsed.error });
        return;
      }

      const [headerRow, ...dataRows] = parsed.rows;
      if (!headerRow) {
        setResult({ kind: 'error', text: copy.noRows });
        return;
      }

      const headers = headerRow.map((header) => header.trim().toLowerCase());
      const hasDuplicateHeaders = headers.some(
        (header, index) => headers.indexOf(header) !== index
      );
      const hasUnknownHeaders = headers.some((header) => !ALLOWED_HEADERS.has(header));
      const hasMissingHeaders = REQUIRED_HEADERS.some((header) => !headers.includes(header));

      if (hasDuplicateHeaders || hasUnknownHeaders || hasMissingHeaders) {
        setResult({ kind: 'error', text: copy.invalidHeader });
        return;
      }

      if (dataRows.length === 0) {
        setResult({ kind: 'error', text: copy.noRows });
        return;
      }
      if (dataRows.length > MAX_IMPORT_ROWS) {
        setResult({ kind: 'error', text: copy.tooMany });
        return;
      }

      const issues: string[] = [];
      const seenSkus = new Set<string>();
      const products: ProductPayload[] = [];

      for (const [index, values] of dataRows.entries()) {
        const rowNumber = index + 2;
        if (values.length !== headers.length) {
          issues.push(
            `Row ${rowNumber}: expected ${headers.length} columns but found ${values.length}.`
          );
          continue;
        }

        const row: Record<string, string> = Object.fromEntries(
          headers.map((header, position) => [header, values[position] ?? ''])
        );
        const name = row.name?.trim() ?? '';
        const sku = row.sku?.trim() ?? '';
        const unitLabel = row.unit?.trim() || '1 pc';
        const pricePaise = parseRupeesToPaise(row.price?.trim() ?? '');
        const mrpPaise = parseRupeesToPaise(row.mrp?.trim() ?? '');
        const stockText = row.stock?.trim() ?? '';
        const quantityAvailable = /^\d+$/.test(stockText) ? Number(stockText) : Number.NaN;

        const rowIssues: string[] = [];
        if (name.length < 2 || name.length > 160) rowIssues.push('name must be 2–160 characters');
        if (!sku || sku.length > 80)
          rowIssues.push('sku is required and must be at most 80 characters');
        if (seenSkus.has(sku.toLocaleLowerCase())) rowIssues.push('sku is duplicated in this CSV');
        if (pricePaise === null)
          rowIssues.push('price must be a valid amount with at most 2 decimals');
        if (mrpPaise === null) rowIssues.push('mrp must be a valid amount with at most 2 decimals');
        if (pricePaise !== null && mrpPaise !== null && pricePaise > mrpPaise) {
          rowIssues.push('price cannot be higher than mrp');
        }
        if (!Number.isSafeInteger(quantityAvailable) || quantityAvailable < 0) {
          rowIssues.push('stock must be a whole number of 0 or more');
        }
        if (unitLabel.length < 1 || unitLabel.length > 60) {
          rowIssues.push('unit must be 1–60 characters');
        }

        if (rowIssues.length > 0) {
          issues.push(`Row ${rowNumber}: ${rowIssues.join(', ')}.`);
          continue;
        }

        seenSkus.add(sku.toLocaleLowerCase());
        products.push({
          name,
          shortDescription: '',
          description: '',
          storeId,
          categoryId,
          unitLabel,
          sku,
          pricePaise: pricePaise as number,
          mrpPaise: mrpPaise as number,
          quantityAvailable,
          lowStockThreshold: 5,
          trackInventory: true,
          allowBackorder: false,
        });
      }

      if (issues.length > 0) {
        const shownIssues = issues.slice(0, 20);
        const remainder = issues.length - shownIssues.length;
        setResult({
          kind: 'error',
          text: `${copy.validation}\n${shownIssues.join('\n')}${remainder > 0 ? `\n… ${remainder} more row errors.` : ''}`,
        });
        return;
      }

      let created = 0;
      const failures: string[] = [];

      for (const [index, payload] of products.entries()) {
        try {
          const response = await fetch('/api/v1/vendor/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || !body?.success) {
            throw new Error(body?.error?.message ?? 'Request failed');
          }
          created += 1;
        } catch (caught) {
          failures.push(
            `Row ${index + 2}: ${caught instanceof Error ? caught.message : 'Request failed'}`
          );
        }
      }

      setResult({
        kind: failures.length > 0 ? 'error' : 'success',
        text: `${created} ${copy.imported}${failures.length ? ` ${failures.length} ${copy.failed}\n${failures.join('\n')}` : ''}`,
      });
    } catch (caught) {
      setResult({
        kind: 'error',
        text: caught instanceof Error ? caught.message : 'Import failed. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>{copy.store}</span>
          <select
            className="bg-background h-10 w-full rounded-lg border px-3"
            value={storeId}
            disabled={busy || stores.length === 0}
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
          <span>{copy.category}</span>
          <select
            className="bg-background h-10 w-full rounded-lg border px-3"
            value={categoryId}
            disabled={busy || categories.length === 0}
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
        <span>{copy.csv}</span>
        <textarea
          className="bg-background min-h-64 w-full rounded-lg border p-3 font-mono text-xs"
          value={csv}
          disabled={busy}
          onChange={(event) => setCsv(event.target.value)}
        />
      </label>

      <div className="text-muted-foreground space-y-1 text-xs">
        <p>{copy.required}</p>
        <p>{copy.limit}</p>
        <p>name,sku,unit,price,mrp,stock</p>
      </div>

      <Button
        onClick={() => void submit()}
        disabled={busy || stores.length === 0 || categories.length === 0 || !storeId || !categoryId}
      >
        {busy ? copy.importing : copy.import}
      </Button>

      {result ? (
        <p
          className={`text-sm whitespace-pre-wrap ${result.kind === 'error' ? 'text-danger' : 'text-foreground'}`}
          role={result.kind === 'error' ? 'alert' : 'status'}
        >
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
