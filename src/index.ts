import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { createHeliusConnection, getSolBalance } from "./solana.js";
import {
  calcShippingLamports,
  describeShipping,
  ShippingItem,
  DropFamily,
} from "./shipping.js";
import { callZW, callAny, callPrepareDeliveryTx, callIssueReceipts } from "./firebase.js";
import { fetchDropAssets } from "./assets.js";
import { probeDropInfo } from "./probe.js";
import { loadKeypairFromEnv, getPubkeyFromKeypairOrEnv } from "./wallet.js";

const HELIUS_KEY = process.env.HELIUS_RPC_KEY || "";
const DEFAULT_DROP = process.env.TARGET_DROP || "card_nft_2";
const DEFAULT_QUANTITY = Number(process.env.QUANTITY || 1);
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

const DEFAULT_COUNTRY = process.env.SHIP_COUNTRY_CODE || "US";
const DEFAULT_EMAIL = process.env.SHIP_EMAIL || "";
const DEFAULT_NAME = process.env.SHIP_NAME || "";
const DEFAULT_ADDR1 = process.env.SHIP_ADDR1 || "";
const DEFAULT_ADDR2 = process.env.SHIP_ADDR2 || "";
const DEFAULT_CITY = process.env.SHIP_CITY || "";
const DEFAULT_STATE = process.env.SHIP_STATE || "";
const DEFAULT_POSTAL = process.env.SHIP_POSTAL || "";
const ENV_WALLET = process.env.WALLET_PUBKEY || "";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "true";
      out[key] = val;
      if (val !== "true") i++;
    }
  }
  return out;
}

function buildFormattedAddress(name: string, addr1: string, addr2: string, city: string, state: string, postal: string): string {
  const parts = [name, addr1, addr2, [city, state].filter(Boolean).join(", "), postal].filter(Boolean);
  return parts.join("\n");
}

async function checkEligibility(dropId: string, wallet: string, connection: Connection) {
  console.log(`\n[eligibility] Checking zW for drop=${dropId} wallet=${wallet.slice(0,4)}...${wallet.slice(-4)}`);
  try {
    const zw = await callZW(dropId, wallet);
    console.log("[eligibility] zW result:", JSON.stringify(zw, null, 2));
    return zw;
  } catch (e: any) {
    console.log("[eligibility] zW failed:", e?.message || e);
    return null;
  }
}

async function main() {
  const argv = parseArgs();

  const dropId: string = argv.drop || DEFAULT_DROP;
  const quantity: number = Number(argv.qty || argv.quantity || DEFAULT_QUANTITY);
  const country: string = argv.country || DEFAULT_COUNTRY;
  const dryRun: boolean = argv["dry-run"] !== undefined ? argv["dry-run"] !== "false" : DRY_RUN;

  const keypair = loadKeypairFromEnv();
  let walletPubkey: string = argv.wallet || ENV_WALLET || getPubkeyFromKeypairOrEnv(keypair) || "";

  const email = argv.email || DEFAULT_EMAIL;
  const name = argv.name || DEFAULT_NAME;
  const addr1 = argv.addr1 || DEFAULT_ADDR1;
  const addr2 = argv.addr2 || DEFAULT_ADDR2;
  const city = argv.city || DEFAULT_CITY;
  const state = argv.state || DEFAULT_STATE;
  const postal = argv.postal || DEFAULT_POSTAL;

  console.log("=== Mons.shop Crypto Auto-Buyer (Helius + Firebase) ===");
  console.log({ dropId, quantity, country, dryRun, wallet: walletPubkey ? walletPubkey.slice(0, 4) + "..." + walletPubkey.slice(-4) : "(none)" });
  console.log("");

  if (!HELIUS_KEY) {
    console.error("Missing HELIUS_RPC_KEY in .env or environment");
    process.exit(1);
  }

  const connection: Connection = createHeliusConnection(HELIUS_KEY);

  if (walletPubkey) {
    try {
      const pub = new PublicKey(walletPubkey);
      const bal = await getSolBalance(connection, pub);
      console.log("Wallet SOL balance:", bal.toFixed(6));
      if (bal < 0.5) {
        console.warn("⚠️  Balance may be insufficient for mint + shipping + fees.");
      }
    } catch (e: any) {
      console.warn("Could not check wallet balance:", e?.message || e);
    }
  }

  if (keypair) {
    console.log("Loaded local keypair for signing. Pubkey:", keypair.publicKey.toBase58());
  }

  // Items: treat as figures for now. Use --kind box and --items-per-box N later.
  const kind: "box" | "figure" = (argv.kind as any) === "box" ? "box" : "figure";
  const itemsPerBox = Number(argv["items-per-box"] || (kind === "box" ? 3 : 1)); // common box size guess
  const items: ShippingItem[] = Array.from({ length: quantity }, () => ({ kind }));

  const family: DropFamily = dropId;
  const shipLamports = calcShippingLamports(items, country, itemsPerBox, family);
  const shipSol = shipLamports / 1_000_000_000;

  console.log("\n--- Shipping (exact bundle math) ---");
  console.log("Items:", quantity, kind, "→ total units:", items.length * (kind === "box" ? itemsPerBox : 1));
  console.log("Shipping lamports:", shipLamports, "→ SOL:", shipSol);
  console.log("Description:", describeShipping(items, country, itemsPerBox, family));

  if (name && addr1 && email) {
    const formatted = buildFormattedAddress(name, addr1, addr2, city, state, postal);
    console.log("\n--- Shipping payload (ready for prepareDeliveryTx) ---");
    console.log(JSON.stringify({
      formatted,
      country: argv.countryName || "United States",
      countryCode: country,
      email,
    }, null, 2));
  } else {
    console.log("\n(Provide --name, --addr1, --email or set SHIP_* in .env for full payload)");
  }

  // Live eligibility check (safe, read-only)
  if (walletPubkey) {
    await checkEligibility(dropId, walletPubkey, connection);

    // Also try to see past orders for this drop (may require auth)
    try {
      const orders = await callAny("listFulfillmentOrders", { limit: 3, dropId });
      console.log("\n[listFulfillmentOrders] sample:", JSON.stringify(orders, null, 2).slice(0, 600));
    } catch (e: any) {
      console.log("[listFulfillmentOrders] (may need auth):", e?.message || e);
    }
  } else {
    console.log("\nTip: pass --wallet <your-solana-pubkey> or set WALLET_PUBKEY in .env to test zW eligibility.");
  }

  console.log("\n=== Safety notes ===");
  console.log("- DRY_RUN is currently:", dryRun);
  console.log("- No transactions are sent unless you explicitly run a ship action with confirmation.");
  console.log("- To actually redeem/ship: use --action ship (requires local keypair or you will be shown the tx to sign manually).");

  // === Real ship / redeem flow (only when requested and confirmed) ===
  const action = (argv.action || "").toLowerCase();
  if (action === "ship") {
    if (!walletPubkey) {
      console.error("Need a wallet (--wallet or WALLET_PUBKEY or loaded keypair) to ship.");
      process.exit(1);
    }
    if (!email || !name || !addr1) {
      console.error("Need full shipping details (--name, --addr1, --email or SHIP_* in .env).");
      process.exit(1);
    }

    const formatted = buildFormattedAddress(name, addr1, addr2, city, state, postal);
    const shipPayload = {
      formatted,
      country: argv.countryName || "United States",
      countryCode: country,
      email,
    };

    console.log("\n=== SHIP ACTION ===");
    console.log("dropId:", dropId);
    console.log("owner:", walletPubkey);
    console.log("payload:", shipPayload);

    if (dryRun) {
      console.log("\n[DRY] Would call prepareDeliveryTx now, then sign + issueReceipts.");
      console.log("To actually execute, re-run with DRY_RUN=false in .env (or --dry-run false) and confirm.");
      return;
    }

    // Real execution path - heavy confirmation
    console.log("\n!!! THIS WILL SPEND SOL (shipping) AND SUBMIT ON-CHAIN !!!");
    console.log("Type 'yes' to continue, anything else to abort.");
    const rl = await import("readline").then(m => m.createInterface({ input: process.stdin, output: process.stdout }));
    const answer: string = await new Promise(resolve => rl.question("> ", resolve));
    rl.close();

    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }

    try {
      console.log("[1/3] Calling prepareDeliveryTx...");
      const prep = await callPrepareDeliveryTx({
        owner: walletPubkey,
        dropId,
        // itemIds / addressId can be added if the backend expects them
      });
      console.log("prepare response:", JSON.stringify(prep, null, 2).slice(0, 600));

      if (!prep?.encodedTx) {
        throw new Error("No encodedTx returned from prepareDeliveryTx");
      }

      let signature: string;

      if (keypair) {
        console.log("[2/3] Signing with local keypair...");
        const { Transaction } = await import("@solana/web3.js");
        const tx = Transaction.from(Buffer.from(prep.encodedTx, "base64"));
        tx.sign(keypair);
        signature = tx.signature?.toString("base64") || "";
        if (!signature) throw new Error("Failed to produce signature");
        console.log("Signature produced (base64):", signature.slice(0, 20) + "...");
      } else {
        console.log("[2/3] No local keypair loaded.");
        console.log("Please sign the following base64 transaction yourself (Phantom, Solflare, etc.):");
        console.log(prep.encodedTx);
        const rl2 = await import("readline").then(m => m.createInterface({ input: process.stdin, output: process.stdout }));
        signature = await new Promise(resolve => rl2.question("Paste the base64 signature here: ", resolve));
        rl2.close();
      }

      console.log("[3/3] Calling issueReceipts...");
      const issueRes = await callIssueReceipts({
        owner: walletPubkey,
        deliveryId: (prep as any).deliveryId || "unknown",
        signature,
        dropId,
      });
      console.log("issueReceipts result:", issueRes);
      console.log("Success! Check your wallet for receipt NFT(s) and mons.shop for fulfillment status.");
    } catch (e: any) {
      console.error("Ship flow failed:", e?.message || e);
      if (e?.logs) console.error("Logs:", e.logs);
    }
  }

  // Try to fetch real drop assets / metadata hints (read-only)
  console.log("\n--- Probing public assets for drop ---");
  try {
    const assets = await fetchDropAssets(dropId);
    console.log("Found images:", assets.images);
    console.log("Found json hints:", assets.possibleJson);
    if (assets.images.length === 0 && assets.possibleJson.length === 0) {
      console.log("No public assets found under common paths yet. We may need the exact folder name or Firebase Storage signed URLs.");
    }
  } catch (e: any) {
    console.log("Asset probe failed:", e?.message || e);
  }

  // Probe for drop info / price callables (exploratory, read-only)
  console.log("\n--- Probing for drop info / price callables (may require auth) ---");
  try {
    const probe = await probeDropInfo(dropId);
    for (const [k, v] of Object.entries(probe)) {
      if ((v as any).ok) {
        console.log(`  ${k}: OK →`, (v as any).data);
      } else {
        // only show interesting errors
        if (!/not-found|unauthenticated|permission|auth/i.test((v as any).error)) {
          console.log(`  ${k}:`, (v as any).error);
        }
      }
    }
  } catch (e: any) {
    console.log("Probe failed:", e?.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
