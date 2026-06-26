import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

// Exact Firebase config from the mons.shop production bundle
const firebaseConfig = {
  apiKey: "AIzaSyA3NTv_zfVYMB2VNORxbKg3rJUsiMXIhko",
  authDomain: "mons-shop.firebaseapp.com",
  projectId: "mons-shop",
  storageBucket: "mons-shop.firebasestorage.app",
  messagingSenderId: "804781326988",
  appId: "1:804781326988:web:abeb4da8cfe43318a671a9",
};

let app: ReturnType<typeof initializeApp> | null = null;
let functions: ReturnType<typeof getFunctions> | null = null;

export function getMonsFunctions() {
  if (!functions) {
    app = initializeApp(firebaseConfig);
    functions = getFunctions(app, "us-central1");
  }
  return functions;
}

// Thin typed wrappers around the discovered callable names (from bundle)
export async function callPrepareDeliveryTx(params: {
  owner: string;
  dropId: string;
  itemIds?: number[];
  addressId?: string;
}) {
  const fns = getMonsFunctions();
  const fn = httpsCallable(fns, "prepareDeliveryTx");
  const res = await fn(params);
  return res.data as { encodedTx: string; deliveryId?: string };
}

export async function callIssueReceipts(params: {
  owner: string;
  deliveryId: string;
  signature: string;
  dropId: string;
}) {
  const fns = getMonsFunctions();
  const fn = httpsCallable(fns, "issueReceipts");
  const res = await fn(params);
  return res.data as { receiptsMinted?: number };
}

export async function callZW(dropId: string, address: string) {
  const fns = getMonsFunctions();
  const fn = httpsCallable(fns, "zW"); // discount proof lookup
  const res = await fn({ dropId, address });
  return res.data;
}

export async function callRA(fe: any, address: string, p: any) {
  const fns = getMonsFunctions();
  const fn = httpsCallable(fns, "rA");
  const res = await fn({ fe, address, p });
  return res.data;
}

// Generic helper if we need to discover more callables at runtime
export async function callAny(name: string, data: unknown) {
  const fns = getMonsFunctions();
  const fn = httpsCallable(fns, name);
  const res = await fn(data);
  return res.data;
}
