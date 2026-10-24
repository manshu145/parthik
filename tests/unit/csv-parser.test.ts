import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from '@/lib/csv/parse-csv-records';

describe('parseCsvRecords', () => {
  it('preserves commas inside quoted fields and escaped quotes', () => {
    expect(parseCsvRecords('name,sku\n"Jam, local",SKU-1\n"Say ""hello""",SKU-2')).toEqual({
      success: true,
      rows: [
        ['name', 'sku'],
        ['Jam, local', 'SKU-1'],
        ['Say "hello"', 'SKU-2'],
      ],
    });
  });

  it('keeps line breaks inside quoted fields within a single record', () => {
    expect(parseCsvRecords('name,sku\n"Line one\nLine two",SKU-1')).toEqual({
      success: true,
      rows: [
        ['name', 'sku'],
        ['Line one\nLine two', 'SKU-1'],
      ],
    });
  });

  it('ignores empty records and normalizes surrounding whitespace', () => {
    expect(parseCsvRecords(' name , sku \n\n Product , SKU-1 \n')).toEqual({
      success: true,
      rows: [
        ['name', 'sku'],
        ['Product', 'SKU-1'],
      ],
    });
  });

  it.each([
    ['name,sku\n"unfinished,SKU-1', 'CSV contains an unterminated quoted field.'],
    ['name,sku\n"closed"tail,SKU-1', 'Unexpected text after a closing quote.'],
    ['name,sku\nvalue"quote,SKU-1', 'A quote appeared inside an unquoted field.'],
  ])('rejects malformed CSV: %s', (input, error) => {
    expect(parseCsvRecords(input)).toEqual({ success: false, error });
  });
});
