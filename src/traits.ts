import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Console trait explorer + filter for card_nft_2 (and similar mons collections).
 * Uses your Helius RPC key (from .env HELIUS_RPC_KEY) + Helius DAS.
 *
 * Usage examples:
 *   npx tsx src/traits.ts
 *   npx tsx src/traits.ts --collection EAzEpagtyeRAx9npnpVMpygoA8ouX7DRpLTghhPvYTiu
 *   npx tsx src/traits.ts --filter "type:card" --filter "redeemed:False"
 *   npx tsx src/traits.ts --search "dragon" --limit 100
 *   npx tsx src/traits.ts --interactive
 */

const HELIUS_KEY = process.env.HELIUS_RPC_KEY || "";
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

type Asset = any;

interface TraitFilter {
  [trait: string]: string | string[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, any> = { filters: {}, limit: 200, search: null, interactive: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--collection" && args[i + 1]) {
      out.collection = args[i + 1];
      i++;
    } else if (a === "--filter" && args[i + 1]) {
      const [k, ...rest] = args[i + 1].split(":");
      const v = rest.join(":");
      if (k && v) {
        if (out.filters[k]) {
          const cur = out.filters[k];
          out.filters[k] = Array.isArray(cur) ? [...cur, v] : [cur, v];
        } else {
          out.filters[k] = v;
        }
      }
      i++;
    } else if (a === "--search" && args[i + 1]) {
      out.search = args[i + 1].toLowerCase();
      i++;
    } else if (a === "--limit" && args[i + 1]) {
      out.limit = parseInt(args[i + 1], 10) || 200;
      i++;
    } else if (a === "--interactive" || a === "-i") {
      out.interactive = true;
    } else if (a === "--slug" && args[i + 1]) {
      out.slug = args[i + 1];
      i++;
    } else if (a === "--wallet" && args[i + 1]) {
      out.wallet = args[i + 1];
      i++;
    }
  }
  return out;
}

async function fetchPage(collection: string, page: number, limit: number): Promise<Asset[]> {
  const body = {
    jsonrpc: "2.0",
    id: "traits",
    method: "getAssetsByGroup",
    params: {
      groupKey: "collection",
      groupValue: collection,
      page,
      limit,
    },
  };
  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Helius ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result?.items || [];
}

function extractTraits(asset: Asset): Record<string, string> {
  const attrs = asset?.content?.metadata?.attributes || [];
  const out: Record<string, string> = {};
  for (const a of attrs) {
    if (a?.trait_type && a?.value != null) {
      out[String(a.trait_type)] = String(a.value);
    }
  }
  return out;
}

function buildTraitIndex(assets: Asset[]) {
  const index: Record<string, Record<string, number>> = {};
  for (const a of assets) {
    const t = extractTraits(a);
    for (const [k, v] of Object.entries(t)) {
      index[k] ||= {};
      index[k][v] = (index[k][v] || 0) + 1;
    }
  }
  return index;
}

function filterAssets(assets: Asset[], filters: TraitFilter, search: string | null) {
  return assets.filter((a) => {
    const traits = extractTraits(a);
    const name = (a?.content?.metadata?.name || "").toLowerCase();
    if (search && !name.includes(search)) return false;
    for (const [k, want] of Object.entries(filters)) {
      const have = traits[k];
      if (!have) return false;
      if (Array.isArray(want)) {
        if (!want.some((w) => have === w)) return false;
      } else {
        if (have !== want) return false;
      }
    }
    return true;
  });
}

function printTraitIndex(index: Record<string, Record<string, number>>) {
  console.log("\n=== Trait Index (value counts) ===");
  const entries = Object.entries(index).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [trait, vals] of entries) {
    const sorted = Object.entries(vals).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 8).map(([v, c]) => `${v}(${c})`).join(", ");
    console.log(`${trait}: ${top}${sorted.length > 8 ? " ..." : ""}`);
  }
}

function printAssets(assets: Asset[], max = 30) {
  console.log(`\n=== Matching items (${assets.length} total, showing ${Math.min(max, assets.length)}) ===`);
  for (const a of assets.slice(0, max)) {
    const name = a?.content?.metadata?.name || a?.id;
    const mint = a?.id;
    const traits = extractTraits(a);
    const traitStr = Object.entries(traits).map(([k, v]) => `${k}:${v}`).join(" | ");
    console.log(`${name}  [${mint}]`);
    if (traitStr) console.log("   " + traitStr);
  }
}

async function interactive(assets: Asset[]) {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nInteractive mode. Commands:");
  console.log("  filter Trait:Value     (e.g. filter type:card)");
  console.log("  search <text>");
  console.log("  clear");
  console.log("  list [n]");
  console.log("  quit");
  let current = assets;

  const prompt = () => rl.question("> ", async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    if (cmd === "quit" || cmd === "exit") {
      rl.close();
      return;
    }
    if (cmd === "filter" && parts[1]) {
      const [k, ...rest] = parts[1].split(":");
      const v = rest.join(":");
      if (k && v) {
        // simple AND filter
        current = current.filter((a) => {
          const t = extractTraits(a);
          return t[k] === v;
        });
        console.log(`Filtered to ${current.length} items.`);
      }
    } else if (cmd === "search" && parts[1]) {
      const q = parts.slice(1).join(" ").toLowerCase();
      current = current.filter((a) => (a?.content?.metadata?.name || "").toLowerCase().includes(q));
      console.log(`Search matched ${current.length} items.`);
    } else if (cmd === "clear") {
      current = assets;
      console.log("Cleared filters.");
    } else if (cmd === "list") {
      const n = parseInt(parts[1] || "20", 10);
      printAssets(current, n);
    } else if (cmd === "traits") {
      const idx = buildTraitIndex(current);
      printTraitIndex(idx);
    } else {
      console.log("Unknown command. Try: filter, search, list, traits, clear, quit");
    }
    prompt();
  });
  prompt();
}

async function fetchOwnerAssets(owner: string, limit = 100): Promise<Asset[]> {
  const body = {
    jsonrpc: "2.0",
    id: "owner",
    method: "getAssetsByOwner",
    params: { ownerAddress: owner, page: 1, limit },
  };
  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Helius owner ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result?.items || [];
}

async function discoverCardCollectionsFromWallet(owner: string) {
  console.log("Scanning your wallet for card/mons-like collections...");
  const items = await fetchOwnerAssets(owner, 200);
  const byColl: Record<string, { count: number; sampleName?: string; sampleTraits: Record<string, string> }> = {};
  for (const it of items) {
    let coll: string | null = null;
    for (const g of it.grouping || []) {
      if (g.group_key === "collection") coll = g.group_value;
    }
    if (!coll) continue;
    const name = it?.content?.metadata?.name || "";
    const sym = (it?.content?.metadata?.symbol || "").toLowerCase();
    const isCardLike = /card|mons|receipt|dude|figure/.test(name.toLowerCase()) || /card|mons/.test(sym);
    if (!isCardLike) continue;
    if (!byColl[coll]) {
      byColl[coll] = { count: 0, sampleName: name, sampleTraits: extractTraits(it) };
    }
    byColl[coll].count++;
  }
  const entries = Object.entries(byColl).sort((a, b) => b[1].count - a[1].count);
  console.log(`Found ${entries.length} card-like collections in your wallet:`);
  entries.forEach(([c, info], i) => {
    console.log(`  ${i + 1}. ${c}  (you own ~${info.count})  e.g. "${info.sampleName}"`);
    const t = Object.entries(info.sampleTraits).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(" | ");
    if (t) console.log(`     sample traits: ${t}`);
  });
  return entries.map(([c]) => c);
}

async function main() {
  if (!HELIUS_KEY) {
    console.error("Missing HELIUS_RPC_KEY in .env");
    process.exit(1);
  }

  const argv = parseArgs();

  let collection = argv.collection;

  const envWallet = process.env.WALLET_PUBKEY || "";

  // Support the Tensor slug directly
  if (!collection && argv.slug) {
    if (argv.slug === "card_nft_2") {
      // These are the real collection pubkeys we saw in your wallet for "card" items
      // The first one is usually the main "card_nft_2" set
      collection = "EAzEpagtyeRAx9npnpVMpygoA8ouX7DRpLTghhPvYTiu";
    }
  }

  if (!collection && (argv.wallet || envWallet)) {
    const w = argv.wallet || envWallet;
    const cols = await discoverCardCollectionsFromWallet(w);
    if (cols.length) {
      collection = cols[0];
      console.log("\nAuto-picked first card-like collection from your wallet:", collection);
    }
  }

  // Default collection candidates from previous DAS scans on this wallet
  // These are the real on-chain collection addresses for various "card" mons items.
  const defaultCollections = [
    "EAzEpagtyeRAx9npnpVMpygoA8ouX7DRpLTghhPvYTiu", // card 3814 style
    "HpGDYGz6aRUs5qbvp1dmWGKTicQctX4PixfcouAQDCHF", // "card" symbol items
    "JCTP3kK3xGtWs5mDHxJBuRro38HftaiCDdKsfkXuK2gH", // receipt cards
  ];

  if (!collection) collection = defaultCollections[0];

  console.log("Using collection:", collection);
  console.log("Fetching assets via Helius DAS (this may take a few seconds for large pages)...");

  let all: Asset[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 20; page++) { // safety cap
    try {
      const pageItems = await fetchPage(collection, page, pageSize);
      all = all.concat(pageItems);
      if (pageItems.length < pageSize) break;
      if (all.length >= (argv.limit || 500)) break;
    } catch (e: any) {
      console.error("Fetch error on page", page, e?.message || e);
      break;
    }
  }

  console.log("Fetched", all.length, "assets for collection.");

  const index = buildTraitIndex(all);
  printTraitIndex(index);

  let filtered = filterAssets(all, argv.filters, argv.search);
  if (Object.keys(argv.filters).length || argv.search) {
    console.log(`After filters: ${filtered.length} items`);
  }

  printAssets(filtered, 25);

  if (argv.interactive) {
    await interactive(filtered.length ? filtered : all);
  } else {
    console.log("\nTips:");
    console.log("  npx tsx src/traits.ts --collection <pubkey> --filter 'type:card' --filter 'redeemed:False'");
    console.log("  npx tsx src/traits.ts --search dragon --limit 50");
    console.log("  npx tsx src/traits.ts --interactive");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
