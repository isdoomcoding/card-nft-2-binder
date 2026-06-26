/**
 * CLI to explore card_nft_2 on Tensor:
 *   npx tsx src/cli-tensor.ts                 # show trait index + top listings
 *   npx tsx src/cli-tensor.ts --filter 'Background:Red' --filter 'Clothing:Hoodie'
 *   npx tsx src/cli-tensor.ts --filter 'Hat:Cap' --min 0.1 --max 1.5
 */
import "dotenv/config";
import { getTensorListings, buildTraitIndex, filterByTraits, TensorListing } from "./tensor.js";

function parseFilters(args: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--filter" && args[i + 1]) {
      const [k, v] = args[i + 1].split(":");
      if (!k || !v) continue;
      if (out[k]) {
        const cur = out[k];
        out[k] = Array.isArray(cur) ? [...cur, v] : [cur as string, v];
      } else {
        out[k] = v;
      }
      i++;
    }
  }
  return out;
}

function parseNum(arg: string | undefined): number | undefined {
  const n = Number(arg);
  return Number.isFinite(n) ? n : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  let slug = "card_nft_2";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--slug" && argv[i + 1]) {
      slug = argv[i + 1];
      i++;
    }
  }
  const min = parseNum(argv.find((a, i) => a === "--min" && argv[i + 1]) ? argv[argv.indexOf("--min") + 1] : undefined);
  const max = parseNum(argv.find((a, i) => a === "--max" && argv[i + 1]) ? argv[argv.indexOf("--max") + 1] : undefined);

  console.log("Fetching Tensor listings for", slug, "...");
  const listings: TensorListing[] = await getTensorListings(slug, 200);
  console.log("Raw listings fetched:", listings.length);

  // price filter (Tensor prices are in lamports strings)
  let filtered = listings;
  if (min != null || max != null) {
    filtered = filtered.filter((l) => {
      const sol = Number(l.price) / 1e9;
      if (min != null && sol < min) return false;
      if (max != null && sol > max) return false;
      return true;
    });
  }

  const traitFilters = parseFilters(argv);
  if (Object.keys(traitFilters).length) {
    console.log("Applying trait filters:", traitFilters);
    filtered = filterByTraits(filtered, traitFilters);
  }

  // build trait index from (filtered or full) set for display
  const idx = buildTraitIndex(filtered.length ? filtered : listings);
  console.log("\n=== Trait counts (from current result set) ===");
  for (const [trait, vals] of Object.entries(idx)) {
    const top = Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`${trait}:`, top.map(([v, c]) => `${v}(${c})`).join("  "));
  }

  console.log("\n=== Matching listings ===");
  const show = (filtered.length ? filtered : listings).slice(0, 30);
  for (const l of show) {
    const sol = (Number(l.price) / 1e9).toFixed(3);
    const traits = (l.attributes || []).map((a) => `${a.trait_type}:${a.value}`).join(" | ");
    console.log(`${sol} SOL  mint:${l.mint}  ${l.name || ""}`);
    if (traits) console.log("   ", traits);
  }

  if (!show.length) {
    console.log("(no matches)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
