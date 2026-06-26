/**
 * Try to discover the internal dropId mapping and any callable that returns drop info / price.
 * This is exploration — many will 404 or require auth.
 */
export async function probeDropInfo(dropId: string) {
  const candidates = [
    "getDrop",
    "getDropInfo",
    "drop",
    "getCollection",
    "listDrops",
    "getMintPrice",
    "getDropPrice",
  ];

  const results: Record<string, any> = {};

  for (const name of candidates) {
    try {
      // We reuse the generic caller from firebase.ts
      const { callAny } = await import("./firebase.js");
      const data = await callAny(name, { dropId });
      results[name] = { ok: true, data: JSON.stringify(data).slice(0, 400) };
    } catch (e: any) {
      results[name] = { ok: false, error: e?.message || String(e) };
    }
  }
  return results;
}
