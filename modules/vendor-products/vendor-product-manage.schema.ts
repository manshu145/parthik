import { z } from 'zod';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const vendorProductInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    shortDescription: nullableText(320),
    description: nullableText(5000),
    storeId: z.string().uuid(),
    categoryId: z.string().uuid(),
    unitLabel: z.string().trim().min(1).max(60),
    sku: nullableText(80),
    pricePaise: z.number().int().min(0),
    mrpPaise: z.number().int().min(0),
    quantityAvailable: z.number().int().min(0),
    lowStockThreshold: z.number().int().min(0).default(0),
    trackInventory: z.boolean().default(true),
    allowBackorder: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.pricePaise > value.mrpPaise) {
      ctx.addIssue({
        code: 'custom',
        path: ['pricePaise'],
        message: 'Selling price cannot be higher than MRP.',
      });
    }
  });

export const vendorProductUpdateSchema = vendorProductInputSchema.and(
  z.object({ version: z.number().int().positive() })
);

export type VendorProductInput = z.infer<typeof vendorProductInputSchema>;
export type VendorProductUpdateInput = z.infer<typeof vendorProductUpdateSchema>;
