# Card NFT 2 Binder

A fan-made browser for the [Card NFT 2](https://x.com/bis__cut) collection by evil biscuit — built on Solana.

Browse all 7,645 cards, filter by traits, view holo effects, and check wallet ownership.

---

## Stack

- Single-file frontend: `card-nft-2-binder.html` (HTML + CSS + JS, no build step)
- Node.js server: `minimal-server.js` — serves the HTML, proxies Helius DAS calls, caches the collection

---

## Setup

### 1. Get a Helius API key

Sign up at [helius.dev](https://helius.dev) and create an API key with DAS access.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```
HELIUS_RPC_KEY=your_helius_api_key_here
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run

```bash
node minimal-server.js
```

The server starts on port **3000** by default. Open `http://localhost:3000` in your browser.

On first start it fetches the full collection from Helius (~7,645 assets). This takes a few seconds and the result is cached in memory with stale-while-revalidate.

---

## Production deployment

The included server is production-ready. It pre-compresses responses with gzip and uses stale-while-revalidate caching to minimise Helius API credit usage.

Recommended setup: **pm2** + **nginx** reverse proxy + **cloudflared** tunnel (or your own domain).

```bash
pm2 start minimal-server.js --name card-binder
```

---

## License

Fan-made project by [@isdoomcoding](https://github.com/isdoomcoding) / [@DoomOperator](https://x.com/DoomOperator), released as copyleft FOSS under the [AGPL-3.0 license](LICENSE).

Card NFT 2 artwork is by [evil biscuit](https://x.com/bis__cut). This project is not affiliated with or endorsed by evil biscuit.
