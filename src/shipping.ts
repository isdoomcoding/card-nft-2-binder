// Exact constants and functions reverse-engineered from the mons.shop production bundle.
// All values in lamports (1 SOL = 1_000_000_000 lamports).

export const SHIP_LAMPORTS = {
  INTL_BASE: 250_000_000,   // 0.25 SOL
  INTL_EXTRA: 50_000_000,   // 0.05 SOL
  US_LSB_BASE: 100_000_000, // 0.10 SOL for little_swag_boxes
  US_LSB_EXTRA: 25_000_000, // 0.025 SOL
  US_PONCHO: 50_000_000,    // 0.05 SOL flat for poncho_drifella
  INTL_HOODIE_BASE: 600_000_000, // 0.60
  INTL_HOODIE_EXTRA: 500_000_000, // 0.50
} as const;

export type DropFamily =
  | "little_swag_boxes"
  | "little_swag_boxes_devnet"
  | "poncho_drifella"
  | "little_swag_hoodies"
  | "card_nft_2"
  | string; // allow future ones

export interface ShippingItem {
  kind: "box" | "figure";
}

export function toPositiveInt(n: number | string): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function isZeroish(n: number | string): boolean {
  const v = Number(n);
  return Number.isFinite(v) && Math.floor(v) === 0;
}

/**
 * Lq: total item count.
 * boxes count as `itemsPerBox` each, figures count as 1.
 */
export function countItems(items: ShippingItem[], itemsPerBox: number): number {
  const n = toPositiveInt(itemsPerBox);
  return items.reduce((sum, it) => sum + (it.kind === "box" ? n : 1), 0);
}

/**
 * Pq: US base shipping for a family.
 */
export function calcUSBase(items: number, itemsPerBox: number, family: DropFamily): number {
  if (items <= 0 || isZeroish(itemsPerBox)) return 0;
  const r = toPositiveInt(itemsPerBox);
  if (family === "little_swag_boxes" || family === "little_swag_boxes_devnet") {
    const extra = Math.max(0, items - r);
    return SHIP_LAMPORTS.US_LSB_BASE + extra * SHIP_LAMPORTS.US_LSB_EXTRA;
  }
  if (family === "poncho_drifella") {
    return SHIP_LAMPORTS.US_PONCHO;
  }
  return 0;
}

/**
 * Uq: main shipping calculator (exact match to bundle logic).
 * Returns lamports required for shipping.
 */
export function calcShippingLamports(
  items: ShippingItem[],
  countryCode: string,
  itemsPerBox: number,
  family: DropFamily
): number {
  const a = toPositiveInt(itemsPerBox);
  const isUS = countryCode.toUpperCase() === "US";
  const total = countItems(items, itemsPerBox);

  if (total <= 0) return 0;

  if (family === "little_swag_hoodies") {
    if (isUS) return 0;
    const extra = Math.max(0, total - 1);
    return SHIP_LAMPORTS.INTL_HOODIE_BASE + extra * SHIP_LAMPORTS.INTL_HOODIE_EXTRA;
  }

  if (isUS) {
    return calcUSBase(total, itemsPerBox, family);
  }

  // International default
  const extra = Math.max(0, total - a);
  return SHIP_LAMPORTS.INTL_BASE + extra * SHIP_LAMPORTS.INTL_EXTRA;
}

/** Human friendly description matching the UI text in the bundle. */
export function describeShipping(
  items: ShippingItem[],
  countryCode: string,
  itemsPerBox: number,
  family: DropFamily
): string {
  const isUS = countryCode.toUpperCase() === "US";
  const total = countItems(items, itemsPerBox);
  const unit = items.some(i => i.kind === "box") ? "box" : "figure";
  const le = toPositiveInt(itemsPerBox);

  if (family === "little_swag_hoodies") {
    return isUS
      ? "Free US shipping"
      : `International delivery: 0.6 SOL for the first ${le}. 0.5 SOL each additional ${le}.`;
  }

  if (isUS) {
    if (items.some(i => i.kind === "box") && (family === "little_swag_boxes" || family === "little_swag_boxes_devnet")) {
      return `US delivery: 0.1 SOL up to ${le} ${unit}. 0.025 SOL each additional ${unit}.`;
    }
    if (family === "poncho_drifella") {
      return "US delivery: 0.05 SOL flat.";
    }
    return "Free US shipping";
  }

  return `International delivery: 0.25 SOL up to ${le} ${unit}. 0.05 SOL each additional ${unit}.`;
}
