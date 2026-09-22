import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  auditLogs,
  brandTranslations,
  brands,
  categories,
  categoryTranslations,
  productTranslations,
  products,
} from '@/db/schema';
import { getDb } from '@/lib/db/client';
import { NotFoundError } from '@/lib/errors';

export type TranslationEntity = 'category' | 'brand' | 'product';

export interface TranslationWriteInput {
  name: string;
  description: string | null;
  shortDescription: string | null;
  unitLabel: string | null;
}

export async function listAdminTranslationRows() {
  const db = await getDb();

  const categoryEn = alias(categoryTranslations, 'category_translation_en');
  const categoryHi = alias(categoryTranslations, 'category_translation_hi');
  const brandEn = alias(brandTranslations, 'brand_translation_en');
  const brandHi = alias(brandTranslations, 'brand_translation_hi');
  const productEn = alias(productTranslations, 'product_translation_en');
  const productHi = alias(productTranslations, 'product_translation_hi');

  const [categoryRows, brandRows, productRows] = await Promise.all([
    db
      .select({
        id: categories.id,
        slug: categories.slug,
        englishName: categoryEn.name,
        englishDescription: categoryEn.description,
        hindiName: categoryHi.name,
        hindiDescription: categoryHi.description,
      })
      .from(categories)
      .leftJoin(
        categoryEn,
        and(eq(categoryEn.categoryId, categories.id), eq(categoryEn.locale, 'en'))
      )
      .leftJoin(
        categoryHi,
        and(eq(categoryHi.categoryId, categories.id), eq(categoryHi.locale, 'hi'))
      )
      .where(isNull(categories.deletedAt))
      .orderBy(asc(categories.slug))
      .limit(300),

    db
      .select({
        id: brands.id,
        slug: brands.slug,
        englishName: brandEn.name,
        hindiName: brandHi.name,
      })
      .from(brands)
      .leftJoin(brandEn, and(eq(brandEn.brandId, brands.id), eq(brandEn.locale, 'en')))
      .leftJoin(brandHi, and(eq(brandHi.brandId, brands.id), eq(brandHi.locale, 'hi')))
      .where(isNull(brands.deletedAt))
      .orderBy(asc(brands.slug))
      .limit(300),

    db
      .select({
        id: products.id,
        slug: products.slug,
        englishName: productEn.name,
        englishShortDescription: productEn.shortDescription,
        englishDescription: productEn.description,
        englishUnitLabel: productEn.unitLabel,
        hindiName: productHi.name,
        hindiShortDescription: productHi.shortDescription,
        hindiDescription: productHi.description,
        hindiUnitLabel: productHi.unitLabel,
      })
      .from(products)
      .leftJoin(
        productEn,
        and(eq(productEn.productId, products.id), eq(productEn.locale, 'en'))
      )
      .leftJoin(
        productHi,
        and(eq(productHi.productId, products.id), eq(productHi.locale, 'hi'))
      )
      .where(isNull(products.deletedAt))
      .orderBy(asc(products.slug))
      .limit(500),
  ]);

  return {
    categories: categoryRows.map((row) => ({
      entity: 'category' as const,
      id: row.id,
      slug: row.slug,
      englishName: row.englishName ?? '',
      englishDescription: row.englishDescription ?? null,
      englishShortDescription: null,
      englishUnitLabel: null,
      hindiName: row.hindiName ?? null,
      hindiDescription: row.hindiDescription ?? null,
      hindiShortDescription: null,
      hindiUnitLabel: null,
    })),
    brands: brandRows.map((row) => ({
      entity: 'brand' as const,
      id: row.id,
      slug: row.slug,
      englishName: row.englishName ?? '',
      englishDescription: null,
      englishShortDescription: null,
      englishUnitLabel: null,
      hindiName: row.hindiName ?? null,
      hindiDescription: null,
      hindiShortDescription: null,
      hindiUnitLabel: null,
    })),
    products: productRows.map((row) => ({
      entity: 'product' as const,
      id: row.id,
      slug: row.slug,
      englishName: row.englishName ?? '',
      englishDescription: row.englishDescription ?? null,
      englishShortDescription: row.englishShortDescription ?? null,
      englishUnitLabel: row.englishUnitLabel ?? null,
      hindiName: row.hindiName ?? null,
      hindiDescription: row.hindiDescription ?? null,
      hindiShortDescription: row.hindiShortDescription ?? null,
      hindiUnitLabel: row.hindiUnitLabel ?? null,
    })),
  };
}

export async function saveHindiTranslation(
  entity: TranslationEntity,
  id: string,
  input: TranslationWriteInput,
  actorUserId: string
) {
  const db = await getDb();

  return db.transaction(async (tx) => {
    if (entity === 'category') {
      const [base] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
        .limit(1);
      if (!base) throw new NotFoundError('Category not found.');

      await tx
        .insert(categoryTranslations)
        .values({
          categoryId: id,
          locale: 'hi',
          name: input.name,
          description: input.description,
          updatedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [categoryTranslations.categoryId, categoryTranslations.locale],
          set: {
            name: input.name,
            description: input.description,
            updatedBy: actorUserId,
            updatedAt: new Date(),
          },
        });
    } else if (entity === 'brand') {
      const [base] = await tx
        .select({ id: brands.id })
        .from(brands)
        .where(and(eq(brands.id, id), isNull(brands.deletedAt)))
        .limit(1);
      if (!base) throw new NotFoundError('Brand not found.');

      await tx
        .insert(brandTranslations)
        .values({
          brandId: id,
          locale: 'hi',
          name: input.name,
          updatedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [brandTranslations.brandId, brandTranslations.locale],
          set: {
            name: input.name,
            updatedBy: actorUserId,
            updatedAt: new Date(),
          },
        });
    } else {
      const [base] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, id), isNull(products.deletedAt)))
        .limit(1);
      if (!base) throw new NotFoundError('Product not found.');

      await tx
        .insert(productTranslations)
        .values({
          productId: id,
          locale: 'hi',
          name: input.name,
          shortDescription: input.shortDescription,
          description: input.description,
          unitLabel: input.unitLabel,
          updatedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [productTranslations.productId, productTranslations.locale],
          set: {
            name: input.name,
            shortDescription: input.shortDescription,
            description: input.description,
            unitLabel: input.unitLabel,
            updatedBy: actorUserId,
            updatedAt: new Date(),
          },
        });
    }

    await tx.insert(auditLogs).values({
      actorUserId,
      actorRole: 'ADMIN',
      action: 'UPDATE',
      entityType: entity + '_translation',
      entityId: id,
      after: { locale: 'hi', name: input.name },
      changedFields: ['hi.name', 'hi.description', 'hi.shortDescription', 'hi.unitLabel'],
      reason: 'Hindi translation updated',
    });

    return { id, entity, locale: 'hi' as const };
  });
}
