import { Connection, PublicKey } from "@solana/web3.js";

export function createHeliusConnection(apiKey: string): Connection {
  if (!apiKey || apiKey.length < 10) {
    throw new Error("Invalid or missing HELIUS_RPC_KEY");
  }
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  return new Connection(url, "confirmed");
}

export async function getSolBalance(connection: Connection, pubkey: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(pubkey);
  return lamports / 1_000_000_000;
}
