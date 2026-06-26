const ASSETS_BASE = "https://assets.mons.link/drops";

export interface BasicDropInfo {
  dropId: string;
  images: string[];
  possibleJson: string[];
}

/**
 * Best-effort discovery of assets for a drop family.
 * Tries common folder names derived from the dropId.
 */
export async function fetchDropAssets(dropId: string): Promise<BasicDropInfo> {
  const aliases = new Set([
    dropId,
    dropId.toLowerCase(),
    dropId.replace(/_/g, ""),
    dropId.replace(/_/g, "-"),
    "lsb", "lswag", "little_swag", "little_swag_boxes",
    "card_nft_2", "cardnft2", "card-nft-2",
    "poncho_drifella", "poncho", "drifella",
  ]);
  const candidates = Array.from(aliases);

  const images: string[] = [];
  const possibleJson: string[] = [];

  for (const c of candidates) {
    // Try box default
    const box = `${ASSETS_BASE}/${c}/box/default.webp`;
    const fig = `${ASSETS_BASE}/${c}/figures/1.webp`;
    const pack = `${ASSETS_BASE}/${c}/pack/initial.webp`;

    for (const url of [box, fig, pack]) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) images.push(url);
      } catch {}
    }

    // Try some json locations (we saw patterns in bundle)
    for (const jpath of [
      `${ASSETS_BASE}/${c}/box/1.json`,
      `${ASSETS_BASE}/${c}/json/1.json`,
      `${ASSETS_BASE}/${c}/1.json`,
    ]) {
      try {
        const res = await fetch(jpath, { method: "HEAD" });
        if (res.ok) possibleJson.push(jpath);
      } catch {}
    }
  }

  return { dropId, images: Array.from(new Set(images)), possibleJson: Array.from(new Set(possibleJson)) };
}
