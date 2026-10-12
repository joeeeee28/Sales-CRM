/** Money helpers — all amounts are integer paise (minor units). */

export function formatMoney(paise: number, currency = 'INR', locale = 'en-IN'): string {
  const value = paise / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function parsePriceToPaise(input: string | number): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

/** Percentage markup with rounding to whole paise. */
export function applyMarkupPercent(costPaise: number, percent: number): number {
  return Math.round(costPaise * (1 + percent / 100));
}

export function percentOff(pricePaise: number, compareAtPaise: number): number {
  if (compareAtPaise <= pricePaise) return 0;
  return Math.round(((compareAtPaise - pricePaise) / compareAtPaise) * 100);
}

export function roundToPaise(n: number): number {
  return Math.round(n);
}
