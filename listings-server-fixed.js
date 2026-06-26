#!/usr/bin/env node
/**
 * listings-server.js  (clean, no top-level await)
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ROOT = __dirname;
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'card-nft-2-collection.json');

const SERVER_HELIUS_KEY = process.env.SERVER_HELIUS_KEY || '';
const SERVER_RPC = SERVER_HELIUS_KEY ? `https://mainnet.helius-rpc.com/?api-key=${SERVER_HELIUS_KEY}` : '';

let serverCachedCollection = null;
const SERVER_COLLECTION_TTL = 90_000;

let cachedME = { data: null, ts: 0 };
let cachedTensor = { data: null, ts: 0 };
const ME_TTL_MS = 45_000;
const TENSOR_TTL_MS = 60_000;

function isFresh(cache, ttl) {
  return cache.data && (Date.now() - cache.ts < ttl);
}

function proxyGet(targetUrl, res) {
  const url = new URL(targetUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: { 'accept': 'application/json', 'user-agent': 'card-nft-2-binder-proxy/1.0' }
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 200, {
      'access-control-allow-origin': '*',
      'content-type': upstream.headers['content-type'] || 'application/json'
    });
    upstream.pipe(res);
  });
  req.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy error', detail: String(e) }));
  });
  req.end();
}

function proxyPost(targetUrl, req, res, body) {
  const url = new URL(targetUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const upstreamReq = lib.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'user-agent': 'card-nft-2-binder-proxy/1.0'
    }
  }, (upstream) => {
    res.writeHead(upstream.statusCode || 200, {
      'access-control-allow-origin': '*',
      'content-type': upstream.headers['content-type'] || 'application/json'
    });
    upstream.pipe(res);
  });
  upstreamReq.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy error', detail: String(e) }));
  });
  upstreamReq.write(body);
  upstreamReq.end();
}

async function handleLiveCollection(res) {
  try {
    const now = Date.now();
    if (serverCachedCollection && (now - serverCachedCollection.ts) < SERVER_COLLECTION_TTL) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-source': 'server-cache' });
      return res.end(JSON.stringify(serverCachedCollection.data));
    }

    const all = [];
    const seen = new Set();
    let pageNum = 1;
    const SAFETY = 25;

    while (pageNum <= SAFETY) {
      const body = {
        jsonrpc: '2.0', id: 'server', method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: 'EAzEpagtyeRAx9npnpVMpygoA8ouX7DRpLTghhPvYTiu',
          page: pageNum, limit: 500
        }
      };

      const r = await fetch(SERVER_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      const items = j.result?.items || [];
      if (!items.length) break;

      for (const it of items) {
        if (it?.id && !seen.has(it.id)) {
          seen.add(it.id);
          all.push(it);
        }
      }
      if (items.length < 500) break;
      pageNum++;
    }

    serverCachedCollection = { data: all, ts: Date.now() };
    res.writeHead(200, { 'content-type': 'application/json', 'x-source': 'helius-live' });
    res.end(JSON.stringify(all));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'failed to get collection', detail: String(e) }));
  }
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,accept'
    });
    return res.end();
  }

  if (req.method === 'GET' && urlPath === '/collection') {
    if (SERVER_RPC) {
      handleLiveCollection(res);
      return;
    }
    try {
      if (!fs.existsSync(SNAPSHOT_PATH)) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'no snapshot' }));
      }
      const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-source': 'static-snapshot',
        'cache-control': 'public, max-age=60'
      });
      return res.end(raw);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'failed to read snapshot' }));
    }
  }

  if (req.method === 'GET' && urlPath === '/listings/card_nft_2') {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = `https://api-mainnet.magiceden.dev/v2/collections/card_nft_2/listings${qs}`;

    if (isFresh(cachedME, ME_TTL_MS)) {
      res.writeHead(200, { 'content-type': 'application/json', 'x-cached': 'true' });
      return res.end(JSON.stringify(cachedME.data));
    }

    const url = new URL(target);
    const lib = url.protocol === 'https:' ? https : http;
    const upstreamReq = lib.request({
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'accept': 'application/json', 'user-agent': 'card-nft-2-binder-proxy/1.0' }
    }, (upstream) => {
      let body = '';
      upstream.on('data', c => body += c);
      upstream.on('end', () => {
        try {
          const json = JSON.parse(body);
          cachedME = { data: json, ts: Date.now() };
          res.writeHead(200, { 'content-type': 'application/json', 'x-cached': 'false' });
          res.end(body);
        } catch { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{}'); }
      });
    });
    upstreamReq.on('error', e => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })); });
    upstreamReq.end();
    return;
  }

  if (req.method === 'POST' && urlPath === '/listings/tensor') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (isFresh(cachedTensor, TENSOR_TTL_MS)) {
        res.writeHead(200, { 'content-type': 'application/json', 'x-cached': 'true' });
        return res.end(JSON.stringify(cachedTensor.data));
      }
      const target = 'https://tensor-api.tensor.so/graphql';
      const url = new URL(target);
      const lib = url.protocol === 'https:' ? https : http;
      const upstreamReq = lib.request({
        hostname: url.hostname, port: url.port || 443,
        path: url.pathname + url.search, method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'card-nft-2-binder-proxy/1.0' }
      }, (upstream) => {
        let resp = '';
        upstream.on('data', c => resp += c);
        upstream.on('end', () => {
          try {
            const json = JSON.parse(resp);
            cachedTensor = { data: json, ts: Date.now() };
            res.writeHead(200, { 'content-type': 'application/json', 'x-cached': 'false' });
            res.end(resp);
          } catch { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{}'); }
        });
      });
      upstreamReq.on('error', e => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })); });
      upstreamReq.write(body); upstreamReq.end();
    });
    return;
  }

  let filePath = path.join(ROOT, urlPath === '/' ? '/card-nft-2-binder.html' : urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) filePath = path.join(ROOT, 'card-nft-2-binder.html');
    fs.readFile(filePath, (err2, data) => {
      if (err2) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'access-control-allow-origin': '*' });
      res.end(data);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const hasSnapshot = fs.existsSync(SNAPSHOT_PATH);
  const live = !!SERVER_RPC;
  console.log(`Card NFT 2 binder running on http://localhost:${PORT}`);
  console.log(`Collection: ${live ? 'LIVE (server key)' : (hasSnapshot ? 'static snapshot' : 'MISSING')}`);
  console.log(`Open: http://localhost:${PORT}/card-nft-2-binder.html`);
});
