'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Restriction = {
  restrictionType: 'CATEGORY' | 'PRODUCT' | 'VENDOR' | 'ZONE' | 'USER';
  restrictionId: string;
};

type CouponRow = {
  id: string;
  code: string;
  couponType: 'FLAT' | 'PERCENTAGE' | 'FREE_DELIVERY';
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  scope: 'CART' | 'CATEGORY' | 'PRODUCT' | 'VENDOR' | 'DELIVERY';
  firstOrderOnly: boolean;
  isUserSpecific: boolean;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  nameEn: string | null;
  descriptionEn: string | null;
  nameHi: string | null;
  descriptionHi: string | null;
  restrictions: Restriction[];
};

const EMPTY = {
  code: '',
  couponType: 'FLAT' as CouponRow['couponType'],
  discountValue: '',
  maxDiscountRupees: '',
  minCartRupees: '0',
  scope: 'CART' as CouponRow['scope'],
  firstOrderOnly: false,
  isUserSpecific: false,
  usageLimitTotal: '',
  usageLimitPerUser: '',
  validFrom: '',
  validUntil: '',
  isActive: true,
  nameEn: '',
  descriptionEn: '',
  nameHi: '',
  descriptionHi: '',
  restrictionsText: '',
};

export function CouponManagement({ rows }: { rows: CouponRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }

  function edit(row: CouponRow) {
    setEditingId(row.id);
    setForm({
      code: row.code,
      couponType: row.couponType,
      discountValue:
        row.couponType === 'FLAT'
          ? String(row.discountValue / 100)
          : row.couponType === 'PERCENTAGE'
            ? String(row.discountValue)
            : '0',
      maxDiscountRupees: row.maxDiscountPaise === null ? '' : String(row.maxDiscountPaise / 100),
      minCartRupees: String(row.minCartPaise / 100),
      scope: row.scope,
      firstOrderOnly: row.firstOrderOnly,
      isUserSpecific: row.isUserSpecific,
      usageLimitTotal: row.usageLimitTotal === null ? '' : String(row.usageLimitTotal),
      usageLimitPerUser: row.usageLimitPerUser === null ? '' : String(row.usageLimitPerUser),
      validFrom: toDateTimeInput(row.validFrom),
      validUntil: toDateTimeInput(row.validUntil),
      isActive: row.isActive,
      nameEn: row.nameEn ?? row.code,
      descriptionEn: row.descriptionEn ?? '',
      nameHi: row.nameHi ?? '',
      descriptionHi: row.descriptionHi ?? '',
      restrictionsText: row.restrictions
        .map((restriction) => restriction.restrictionType + ' ' + restriction.restrictionId)
        .join('\n'),
    });
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const restrictions = parseRestrictions(form.restrictionsText);
      const discountValue =
        form.couponType === 'FREE_DELIVERY'
          ? 0
          : form.couponType === 'FLAT'
            ? rupeesToPaise(form.discountValue)
            : integer(form.discountValue, 'percentage');

      const response = await fetch(
        '/api/v1/admin/marketing/coupons' + (editingId ? '/' + editingId : ''),
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: form.code.trim().toUpperCase(),
            couponType: form.couponType,
            discountValue,
            maxDiscountPaise: optionalRupeesToPaise(form.maxDiscountRupees),
            minCartPaise: rupeesToPaise(form.minCartRupees),
            scope: form.scope,
            firstOrderOnly: form.firstOrderOnly,
            isUserSpecific: form.isUserSpecific,
            usageLimitTotal: optionalInteger(form.usageLimitTotal),
            usageLimitPerUser: optionalInteger(form.usageLimitPerUser),
            validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
            validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
            isActive: form.isActive,
            isStackable: false,
            nameEn: form.nameEn.trim(),
            descriptionEn: form.descriptionEn.trim() || null,
            nameHi: form.nameHi.trim() || null,
            descriptionHi: form.descriptionHi.trim() || null,
            restrictions,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save coupon.');

      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save coupon.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{editingId ? 'Edit coupon' : 'Create coupon'}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Rules are validated against the same coupon engine used by cart and checkout.
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
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="CODE"
            disabled={busy}
          />
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.couponType}
            onChange={(e) =>
              setForm({ ...form, couponType: e.target.value as CouponRow['couponType'] })
            }
            disabled={busy}
          >
            <option value="FLAT">Flat discount</option>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FREE_DELIVERY">Free delivery</option>
          </select>
          <Input
            type="number"
            min="0"
            step={form.couponType === 'PERCENTAGE' ? '1' : '0.01'}
            value={form.couponType === 'FREE_DELIVERY' ? '0' : form.discountValue}
            onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
            placeholder={form.couponType === 'PERCENTAGE' ? 'Discount %' : 'Discount ₹'}
            disabled={busy || form.couponType === 'FREE_DELIVERY'}
          />
          <select
            className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value as CouponRow['scope'] })}
            disabled={busy}
          >
            <option value="CART">Whole cart</option>
            <option value="CATEGORY">Category</option>
            <option value="PRODUCT">Product</option>
            <option value="VENDOR">Vendor</option>
            <option value="DELIVERY">Delivery</option>
          </select>

          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.minCartRupees}
            onChange={(e) => setForm({ ...form, minCartRupees: e.target.value })}
            placeholder="Minimum cart ₹"
            disabled={busy}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.maxDiscountRupees}
            onChange={(e) => setForm({ ...form, maxDiscountRupees: e.target.value })}
            placeholder="Max discount ₹ (optional)"
            disabled={busy || form.couponType === 'FREE_DELIVERY'}
          />
          <Input
            type="number"
            min="1"
            step="1"
            value={form.usageLimitTotal}
            onChange={(e) => setForm({ ...form, usageLimitTotal: e.target.value })}
            placeholder="Total usage limit"
            disabled={busy}
          />
          <Input
            type="number"
            min="1"
            step="1"
            value={form.usageLimitPerUser}
            onChange={(e) => setForm({ ...form, usageLimitPerUser: e.target.value })}
            placeholder="Per-user limit"
            disabled={busy}
          />
          <label className="space-y-1 text-xs">
            <span>Valid from</span>
            <Input
              type="datetime-local"
              value={form.validFrom}
              onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              disabled={busy}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span>Valid until</span>
            <Input
              type="datetime-local"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              disabled={busy}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            required
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            placeholder="English offer name"
            disabled={busy}
          />
          <Input
            value={form.nameHi}
            onChange={(e) => setForm({ ...form, nameHi: e.target.value })}
            placeholder="Hindi offer name (optional)"
            disabled={busy}
          />
          <textarea
            className="border-input bg-background min-h-20 rounded-md border p-3 text-sm"
            value={form.descriptionEn}
            onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })}
            placeholder="English description"
            disabled={busy}
          />
          <textarea
            className="border-input bg-background min-h-20 rounded-md border p-3 text-sm"
            value={form.descriptionHi}
            onChange={(e) => setForm({ ...form, descriptionHi: e.target.value })}
            placeholder="Hindi description"
            disabled={busy}
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
          <label className="space-y-1 text-sm">
            <span>Restrictions</span>
            <textarea
              className="border-input bg-background min-h-28 w-full rounded-md border p-3 font-mono text-xs"
              value={form.restrictionsText}
              onChange={(e) => setForm({ ...form, restrictionsText: e.target.value })}
              placeholder={
                'ZONE 00000000-0000-0000-0000-000000000000\nCATEGORY 00000000-0000-0000-0000-000000000000'
              }
              disabled={busy}
            />
            <span className="text-muted-foreground block text-xs">
              One per line: CATEGORY, PRODUCT, VENDOR, ZONE or USER followed by its UUID.
            </span>
          </label>

          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <Check
              label="Active"
              checked={form.isActive}
              onChange={(value) => setForm({ ...form, isActive: value })}
            />
            <Check
              label="First order only"
              checked={form.firstOrderOnly}
              onChange={(value) => setForm({ ...form, firstOrderOnly: value })}
            />
            <Check
              label="User specific"
              checked={form.isUserSpecific}
              onChange={(value) => setForm({ ...form, isUserSpecific: value })}
            />
            <p className="text-muted-foreground pt-2 text-xs">
              Multi-coupon stacking is not enabled because carts currently hold exactly one coupon.
            </p>
          </div>
        </div>

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save coupon'}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-4 py-3">Coupon</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Minimum</th>
              <th className="px-4 py-3">Usage</th>
              <th className="px-4 py-3">Restrictions</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{row.code}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{row.nameEn ?? '—'}</p>
                </td>
                <td className="px-4 py-3">
                  {row.couponType}
                  <p className="text-muted-foreground mt-1 text-xs">
                    {row.couponType === 'FLAT'
                      ? '₹' + (row.discountValue / 100).toFixed(2)
                      : row.couponType === 'PERCENTAGE'
                        ? row.discountValue + '%'
                        : 'Delivery fee waiver'}
                  </p>
                </td>
                <td className="px-4 py-3">{row.scope}</td>
                <td className="px-4 py-3">₹{(row.minCartPaise / 100).toFixed(2)}</td>
                <td className="px-4 py-3">
                  {row.usedCount}
                  {row.usageLimitTotal ? ' / ' + row.usageLimitTotal : ''}
                </td>
                <td className="px-4 py-3">{row.restrictions.length}</td>
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
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function rupeesToPaise(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Enter valid rupee amounts.');
  return Math.round(numeric * 100);
}

function optionalRupeesToPaise(value: string): number | null {
  return value.trim() ? rupeesToPaise(value) : null;
}

function integer(value: string, label: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) throw new Error('Enter a valid ' + label + '.');
  return numeric;
}

function optionalInteger(value: string): number | null {
  return value.trim() ? integer(value, 'usage limit') : null;
}

function parseRestrictions(value: string): Restriction[] {
  const allowed = new Set(['CATEGORY', 'PRODUCT', 'VENDOR', 'ZONE', 'USER']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const rows: Restriction[] = [];

  for (const [index, raw] of value.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [type, id, ...extra] = line.split(/\s+/);
    if (!type || !id || extra.length > 0 || !allowed.has(type) || !uuid.test(id)) {
      throw new Error('Invalid restriction on line ' + (index + 1) + '. Use TYPE UUID.');
    }
    rows.push({ restrictionType: type as Restriction['restrictionType'], restrictionId: id });
  }

  return rows;
}

function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}
