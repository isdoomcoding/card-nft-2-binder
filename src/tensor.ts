/**
 * Tensor.trade helpers for card_nft_2 collection.
 * Uses public Tensor API endpoints (no key needed for basic read).
 * This gives us: listings, active listings, traits/attributes, and filtering.
 */

const TENSOR_BASE = "https://api.tensor.so";

export interface TensorListing {
  mint: string;
  price: string; // lamports as string
  seller: string;
  attributes?: Array<{ trait_type: string; value: string }>;
  name?: string;
}

export async function getTensorCollection(slug: string): Promise<any> {
  // Common Tensor endpoints observed in the wild for v1/v2
  const urls = [
    `${TENSOR_BASE}/v1/collections/${slug}`,
    `${TENSOR_BASE}/collections/${slug}`,
    `${TENSOR_BASE}/api/v1/collections/${slug}`,
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

export async function getTensorListings(slug: string, limit = 100): Promise<TensorListing[]> {
  // Try several known shapes; Tensor changes paths often.
  const candidates = [
    `${TENSOR_BASE}/v1/collections/${slug}/listings?limit=${limit}`,
    `${TENSOR_BASE}/collections/${slug}/listings?limit=${limit}`,
    `${TENSOR_BASE}/api/v1/collections/${slug}/listings?limit=${limit}`,
  ];
  for (const u of candidates) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        // normalize common shapes
        if (Array.isArray(j)) return j;
        if (Array.isArray(j?.listings)) return j.listings;
        if (Array.isArray(j?.data)) return j.data;
        if (Array.isArray(j?.results)) return j.results;
      }
    } catch {}
  }
  return [];
}

/**
 * Build a quick in-memory trait index + filter.
 * Returns { traitType: { value: count } } and a filter function.
 */
export function buildTraitIndex(listings: TensorListing[]) {
  const index: Record<string, Record<string, number>> = {};
  for (const l of listings) {
    for (const a of l.attributes || []) {
      const t = a.trait_type || "unknown";
      const v = String(a.value);
      index[t] ||= {};
      index[t][v] = (index[t][v] || 0) + 1;
    }
  }
  return index;
}

export function filterByTraits(
  listings: TensorListing[],
  wanted: Record<string, string | string[]>
): TensorListing[] {
  return listings.filter((l) => {
    const attrs = Object.fromEntries(
      (l.attributes || []).map((a) => [a.trait_type, String(a.value)])
    );
    for (const [k, want] of Object.entries(wanted)) {
      const have = attrs[k];
      if (!have) return false;
      if (Array.isArray(want)) {
        if (!want.includes(have)) return false;
      } else {
        if (have !== want) return false;
      }
    }
    return true;
  });
}
