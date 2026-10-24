import { describe, expect, it } from 'vitest';
import {
  addPaise,
  clampPaise,
  formatPaise,
  multiplyPaise,
  paise,
  paiseToRupees,
  percentageOfPaise,
  rupeesToPaise,
  subtractPaise,
} from '@/lib/money';

/**
 * Money is the highest-consequence pure logic in the system, so it is tested
 * before anything is built on top of it (docs/ARCHITECTURE.md §13).
 */
describe('money', () => {
  it('rejects non-integer paise', () => {
    expect(() => paise(10.5)).toThrow(TypeError);
  });

  it('rejects unsafe integers', () => {
    expect(() => paise(Number.MAX_SAFE_INTEGER + 2)).toThrow(TypeError);
  });

  it('converts rupees to paise with half-up rounding', () => {
    expect(rupeesToPaise(199)).toBe(19_900);
    expect(rupeesToPaise(4.599)).toBe(460);
    expect(rupeesToPaise(0.005)).toBe(1);
  });

  it('round-trips paise and rupees', () => {
    expect(paiseToRupees(paise(45_900))).toBe(459);
  });

  it('adds and subtracts without floating point drift', () => {
    // The classic 0.1 + 0.2 problem must be impossible here.
    const total = addPaise(paise(10), paise(20), paise(30));
    expect(total).toBe(60);
    expect(subtractPaise(paise(19_900), paise(4_000))).toBe(15_900);
  });

  it('multiplies by an integer quantity only', () => {
    expect(multiplyPaise(paise(4_500), 3)).toBe(13_500);
    expect(() => multiplyPaise(paise(4_500), 1.5)).toThrow(TypeError);
  });

  it('applies percentages with consistent rounding', () => {
    // 10% of ₹199 = ₹19.90 -> 1990 paise
    expect(percentageOfPaise(paise(19_900), 10)).toBe(1_990);
    // Half-up at the boundary: 12.5% of 101 paise = 12.625 -> 13
    expect(percentageOfPaise(paise(101), 12.5)).toBe(13);
  });

  it('clamps to a range', () => {
    expect(clampPaise(paise(5_000), paise(0), paise(3_000))).toBe(3_000);
    expect(clampPaise(paise(-100), paise(0), paise(3_000))).toBe(0);
  });

  describe('formatting', () => {
    it('omits paise when the amount is whole rupees', () => {
      expect(formatPaise(paise(19_900))).toMatch(/199/);
      expect(formatPaise(paise(19_900))).not.toMatch(/\.00/);
    });

    it('shows paise when non-zero', () => {
      expect(formatPaise(paise(19_950))).toMatch(/199\.50/);
    });

    it('formats for both supported locales', () => {
      // Both must produce a rupee amount; grouping conventions may differ.
      expect(formatPaise(paise(1_23_456_00 as number), 'en')).toContain('₹');
      expect(formatPaise(paise(1_23_456_00 as number), 'hi')).toContain('₹');
    });
  });
});
