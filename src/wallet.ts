import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";

export function loadKeypairFromEnv(): Keypair | null {
  // Option 1: direct bs58 secret key in env (DANGER - only for testing)
  const secret = process.env.WALLET_SECRET_KEY_BS58;
  if (secret && secret.length > 40) {
    try {
      const secretKey = bs58.decode(secret);
      return Keypair.fromSecretKey(secretKey);
    } catch (e) {
      console.error("Failed to decode WALLET_SECRET_KEY_BS58");
      return null;
    }
  }

  // Option 2: path to a Solana keypair JSON file (array of 64 numbers or {secretKey})
  const path = process.env.WALLET_KEYPAIR_PATH;
  if (path) {
    try {
      const raw = JSON.parse(fs.readFileSync(path, "utf8"));
      let arr: number[];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (raw && Array.isArray(raw.secretKey)) {
        arr = raw.secretKey;
      } else {
        throw new Error("Unsupported keypair file format");
      }
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch (e: any) {
      console.error("Failed to load keypair from WALLET_KEYPAIR_PATH:", e?.message || e);
      return null;
    }
  }

  return null;
}

export function getPubkeyFromKeypairOrEnv(keypair: Keypair | null, envPubkey?: string): string | null {
  if (keypair) return keypair.publicKey.toBase58();
  if (envPubkey) return envPubkey;
  return null;
}
