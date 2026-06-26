import React, { useEffect, useMemo, useState } from 'react'
import { Search, X, RefreshCw, Bell, Filter, ExternalLink, Heart, ChevronLeft, ChevronRight } from 'lucide-react'

// ONLY Card NFT 2 - hardcoded real collection address
const CARD_NFT_2_COLLECTION = 'EAzEpagtyeRAx9npnpVMpygoA8ouX7DRpLTghhPvYTiu'
const TENSOR_SLUG = 'card_nft_2'

const HELIUS_KEY = (import.meta as any).env?.VITE_HELIUS_RPC_KEY || 'ce5970dd-4d08-4cf4-bbe0-249fc043ad52'
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`

type Asset = any
type TraitMap = Record<string, string>

interface ListingInfo {
  priceSol: number
  url: string
}

function extractTraits(asset: Asset): TraitMap {
  const attrs = asset?.content?.metadata?.attributes || []
  const out: TraitMap = {}
  for (const a of attrs) {
    if (a?.trait_type != null && a.value != null) {
      out[String(a.trait_type)] = String(a.value)
    }
  }
  return out
}

function getImage(asset: Asset): string | null {
  const links = asset?.content?.links
  if (links?.image) return links.image
  const files = asset?.content?.files || []
  const img = files.find((f: any) => typeof f?.mime === 'string' && f.mime.startsWith('image'))
  return img?.uri || null
}

async function fetchCollectionPage(collection: string, page: number, limit = 500): Promise<Asset[]> {
  const body = {
    jsonrpc: '2.0',
    id: 'cardnft2',
    method: 'getAssetsByGroup',
    params: { groupKey: 'collection', groupValue: collection, page, limit },
  }
  const res = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (json.error) throw new Error(JSON.stringify(json.error))
  return json.result?.items || []
}

async function fetchActiveListings(slug: string) {
  // Use Vite dev proxy (see vite.config.ts) to avoid CORS/DNS issues from browser.
  // Proxies: /me-api -> api-mainnet.magiceden.dev , /tensor-api -> api.tensor.so
  const headers = {
    'accept': 'application/json',
    'referer': 'https://www.tensor.trade',
  };

  // === 1. Magic Eden (primary via proxy) ===
  try {
    const all: any[] = [];
    for (let offset = 0; offset < 200; offset += 100) {
      const url = `/me-api/v2/collections/${slug}/listings?offset=${offset}&limit=100`;
      const r = await fetch(url, { headers });
      if (!r.ok) break;
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      all.push(...page);
    }
    if (all.length > 0) {
      return all.map((l: any) => ({
        mint: l.tokenMint || l.mint,
        priceSol: Number(l.price || 0), // ME returns price in SOL already
        seller: l.seller,
        source: 'magiceden',
      }));
    }
  } catch (e) {
    console.warn('Magic Eden listings failed', e);
  }

  // === 2. Tensor GraphQL via proxy (best effort) ===
  try {
    const gql = `
      query CollectionActiveListings($slug: String!, $limit: Int!) {
        collectionActiveListings(slug: $slug, limit: $limit) {
          listings {
            mint
            price
            seller
          }
        }
      }
    `;
    const res = await fetch('/tensor-api/graphql', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ query: gql, variables: { slug, limit: 300 } }),
    });
    if (res.ok) {
      const json = await res.json();
      const listings = json?.data?.collectionActiveListings?.listings;
      if (Array.isArray(listings) && listings.length > 0) {
        return listings.map((l: any) => ({
          mint: l.mint,
          priceSol: Number(l.price || 0) / 1e9,
          seller: l.seller,
          source: 'tensor',
        }));
      }
    }
  } catch (e) {
    console.warn('Tensor GraphQL listings failed', e);
  }

  // === 3. Old Tensor REST via proxy (often dead) ===
  const oldPaths = [
    `/tensor-api/v1/collections/${slug}/listings?limit=300`,
    `/tensor-api/collections/${slug}/listings?limit=300`,
  ];
  for (const url of oldPaths) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) {
        const j = await r.json();
        const list = Array.isArray(j) ? j : (j?.listings || j?.data || j?.results || []);
        if (Array.isArray(list) && list.length > 0) {
          return list.map((l: any) => ({
            mint: l.mint,
            priceSol: Number(l.price || 0) / 1e9,
            seller: l.seller,
            source: 'tensor',
          }));
        }
      }
    } catch {}
  }

  console.warn('All listing sources failed. "Only listed on marketplaces" filter will show 0 items.');
  return [];
}

export default function CardNFT2Binder() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [listings, setListings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadedPages, setLoadedPages] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
  const [onlyListed, setOnlyListed] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 36

  const [watchlist, setWatchlist] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('cardnft2_watchlist') || '{}') } catch { return {} }
  })

  const [lastListingMints, setLastListingMints] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<string[]>([])

  // Progressive load: first page fast → UI appears → rest loads in background with live updates
  async function loadProgressive() {
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setAssets([])
    setLoadedPages(0)

    try {
      // Fire and forget listings (try ME first, then Tensor, etc.)
      fetchActiveListings(TENSOR_SLUG).then(listingsData => {
        setListings(listingsData)
        const mints = new Set(listingsData.map((l: any) => l.mint).filter(Boolean))
        if (lastListingMints.size === 0) setLastListingMints(mints)
      }).catch(() => {})

      // FIRST PAGE - show immediately (using higher limit for speed)
      const first = await fetchCollectionPage(CARD_NFT_2_COLLECTION, 1, 500)
      setAssets(first)
      setLoadedPages(1)
      setLoading(false)     // UI is now usable
      setLoadingMore(true)

      // Keep fetching the FULL collection until we hit an empty page.
      // Magic Eden currently shows ~6,327 supply for card_nft_2.
      // We page with 500 per page until Helius returns 0 items for the group.
      let accumulated = [...first]
      const SAFETY_MAX_PAGES = 20   // 500 * 20 = 10,000 safety cap (more than enough for 6.3k)

      for (let p = 2; p <= SAFETY_MAX_PAGES; p++) {
        try {
          const pageItems = await fetchCollectionPage(CARD_NFT_2_COLLECTION, p, 500)
          if (!pageItems || pageItems.length === 0) {
            break
          }
          accumulated = accumulated.concat(pageItems)
          setAssets(accumulated)     // live update the grid as we go
          setLoadedPages(p)
          if (pageItems.length < 500) {
            break
          }
        } catch (e) {
          console.warn('Failed to load page', p, e)
          break
        }
      }

      setLoadingMore(false)
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Failed to load Card NFT 2')
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    loadProgressive()
  }, [])

  const listedMap = useMemo(() => {
    const map: Record<string, ListingInfo> = {}
    listings.forEach((l: any) => {
      if (l?.mint) {
        map[l.mint] = {
          priceSol: Number(l.priceSol || l.price || 0),
          url: `https://www.tensor.trade/trade/${TENSOR_SLUG}?mint=${l.mint}`,
        }
      }
    })
    return map
  }, [listings])

  const traitIndex = useMemo(() => {
    const idx: Record<string, Record<string, number>> = {}
    assets.forEach(a => {
      const t = extractTraits(a)
      Object.entries(t).forEach(([k, v]) => {
        idx[k] ||= {}
        idx[k][v] = (idx[k][v] || 0) + 1
      })
    })
    return idx
  }, [assets])

  const filtered = useMemo(() => {
    let res = assets
    if (search.trim()) {
      const q = search.toLowerCase()
      res = res.filter(a => (a?.content?.metadata?.name || '').toLowerCase().includes(q))
    }
    Object.entries(activeFilters).forEach(([trait, value]) => {
      res = res.filter(a => extractTraits(a)[trait] === value)
    })
    if (onlyListed) {
      res = res.filter(a => !!listedMap[a.id])
    }
    return res
  }, [assets, search, activeFilters, onlyListed, listedMap])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(currentPage, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  function applyTraitFilter(trait: string, value: string) {
    setActiveFilters(prev => ({ ...prev, [trait]: value }))
    setCurrentPage(1)
    window.scrollTo({ top: 160, behavior: 'smooth' })
  }

  function removeFilter(trait: string) {
    setActiveFilters(prev => {
      const n = { ...prev }
      delete n[trait]
      return n
    })
    setCurrentPage(1)
  }

  function clearAll() {
    setActiveFilters({})
    setSearch('')
    setOnlyListed(false)
    setCurrentPage(1)
  }

  function watchTrait(trait: string, value: string) {
    const next = { ...watchlist, [trait]: value }
    setWatchlist(next)
    localStorage.setItem('cardnft2_watchlist', JSON.stringify(next))
    showToast(`Watching: ${trait} = ${value}`)
  }

  function unwatch(trait: string) {
    const { [trait]: _, ...rest } = watchlist
    setWatchlist(rest)
    localStorage.setItem('cardnft2_watchlist', JSON.stringify(rest))
  }

  function showToast(msg: string) {
    setToasts(t => [...t, msg])
    setTimeout(() => setToasts(t => t.slice(1)), 5200)
  }

  // Poll for new listings (uses the multi-source fetchActiveListings)
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const fresh = await fetchActiveListings(TENSOR_SLUG)
        const freshMints = fresh.map((l: any) => l.mint).filter(Boolean) as string[]
        const newMints = freshMints.filter(m => !lastListingMints.has(m))

        if (newMints.length > 0) {
          setLastListingMints(new Set(freshMints))
          setListings(fresh)

          const watched = Object.entries(watchlist)
          if (watched.length === 0) return

          const newListings = fresh.filter((l: any) => newMints.includes(l.mint))
          for (const listing of newListings) {
            const asset = assets.find(a => a.id === listing.mint)
            if (!asset) continue
            const traits = extractTraits(asset)
            const name = (asset?.content?.metadata?.name || '').toLowerCase()

            let hit = false
            for (const [trait, value] of watched) {
              if (traits[trait] === value || name.includes(value.toLowerCase())) {
                hit = true
                break
              }
            }
            if (hit) {
              const price = Number(listing.price || 0).toFixed(2)
              const body = `${asset?.content?.metadata?.name || listing.mint} listed for ${price} SOL`
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Card NFT 2 • New listing', { body })
              }
              showToast(body)
            }
          }
        }
      } catch {}
    }, 45000)
    return () => clearInterval(id)
  }, [watchlist, lastListingMints, assets])

  const [detail, setDetail] = useState<Asset | null>(null)
  function openDetail(a: Asset) { setDetail(a) }
  function closeDetail() { setDetail(null) }

  const detailTraits = detail ? extractTraits(detail) : {}
  const detailListed = detail ? listedMap[detail.id] : null

  function CardView({ asset }: { asset: Asset }) {
    const name = asset?.content?.metadata?.name || 'Unnamed'
    const img = getImage(asset)
    const traits = extractTraits(asset)
    const listed = listedMap[asset.id]
    const isListed = !!listed

    return (
      <div onClick={() => openDetail(asset)} className="card group cursor-pointer">
        <div className="card-image">
          {img ? (
            <img src={img} alt={name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full bg-zinc-950 flex items-center justify-center text-zinc-700 text-sm">no preview</div>
          )}
          {isListed && (
            <div className="listed-badge">LISTED • {listed.priceSol.toFixed(2)} SOL</div>
          )}
        </div>
        <div className="p-3.5">
          <div className="font-medium text-[13px] text-white truncate leading-tight">{name}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(traits).slice(0, 3).map(([k, v]) => (
              <span
                key={k}
                onClick={(e) => { e.stopPropagation(); applyTraitFilter(k, v) }}
                className="trait-pill hover:scale-105 active:scale-95"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const hasCards = assets.length > 0

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#f1f1f1]">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-[#0a0a0a]/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1280px] mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <div className="text-4xl font-bold tracking-[-2px] text-[#c5a46e]">Card NFT 2</div>
            <div className="text-[11px] text-zinc-500 tracking-[2px] -mt-1">FULL COLLECTION • CLICK TRAITS TO FILTER • TENSOR ALERTS</div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { loadProgressive() }} disabled={loading || loadingMore} className="flex items-center gap-2 px-5 py-2 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-sm disabled:opacity-50">
              <RefreshCw size={16} className={(loading || loadingMore) ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={() => 'Notification' in window && Notification.requestPermission()} className="flex items-center gap-2 px-5 py-2 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-sm">
              <Bell size={16} /> Enable Alerts
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-6 pt-8 pb-20">
        {/* Controls */}
        <div className="flex flex-col lg:flex-row gap-3 mb-4">
          <div className="flex-1 relative">
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
              placeholder="Search name..."
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-600/60 rounded-3xl px-6 py-3.5 text-sm placeholder:text-zinc-600 outline-none"
            />
            <Search className="absolute right-6 top-4 text-zinc-600" size={18} />
          </div>
          <button onClick={() => setOnlyListed(!onlyListed)} className={`px-6 py-3.5 rounded-3xl text-sm font-medium border flex items-center gap-2 transition ${onlyListed ? 'border-red-600 bg-red-950/30 text-red-400' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <Filter size={16} /> {onlyListed ? 'Only listed (marketplaces)' : 'Only show listed on marketplaces'}
          </button>
          <button onClick={clearAll} className="px-6 py-3.5 rounded-3xl text-sm border border-zinc-800 hover:border-zinc-700 flex items-center gap-2">
            <X size={16} /> Clear
          </button>
        </div>

        {/* Active filters */}
        {(Object.keys(activeFilters).length > 0 || search || onlyListed) && (
          <div className="flex flex-wrap gap-2 mb-5">
            {Object.entries(activeFilters).map(([trait, value]) => (
              <div key={trait} className="filter-chip">
                {trait}: <span className="font-medium text-white">{value}</span>
                <button onClick={() => removeFilter(trait)}><X size={13} /></button>
              </div>
            ))}
            {search && <div className="filter-chip">search: <span className="font-medium text-white">{search}</span><button onClick={() => setSearch('')}><X size={13} /></button></div>}
            {onlyListed && <div className="filter-chip text-red-400">only listed <button onClick={() => setOnlyListed(false)}><X size={13} /></button></div>}
          </div>
        )}

        {/* Watchlist bar */}
        <div className="mb-6 p-4 rounded-3xl border border-zinc-800 bg-zinc-950">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-2">
            <Heart size={15} /> Watched traits — browser alerts when these appear in new marketplace listings
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(watchlist).length === 0 ? (
              <div className="text-sm text-zinc-500">No watches. Open a card and click "Watch this trait" in the modal.</div>
            ) : (
              Object.entries(watchlist).map(([trait, value]) => (
                <div key={trait} className="watch-chip">
                  {trait}: {value} <button onClick={() => unwatch(trait)} className="text-amber-600/70 hover:text-amber-400"><X size={13} /></button>
                </div>
              ))
            )}
          </div>
          <div className="text-[10px] text-zinc-600 mt-2">Polls every ~45s.</div>
        </div>

        {/* Stats + progress */}
        <div className="text-xs text-zinc-500 mb-4">
          {assets.length} Card NFT 2 NFTs loaded (page {loadedPages})
          {loadingMore ? ' — loading more in background...' : ''}
          {' • '}{filtered.length} matching • {Object.keys(listedMap).length} listed on marketplaces
        </div>

        {/* Grid */}
        {error ? (
          <div className="text-red-400 py-8">{error}</div>
        ) : !hasCards ? (
          <div className="py-16 text-center">
            <div className="text-zinc-400">Loading Card NFT 2 collection…</div>
            <div className="text-xs text-zinc-600 mt-1">First cards appear in a few seconds</div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {pageItems.length === 0 ? (
                <div className="col-span-full py-12 text-center text-zinc-500">No cards match the current filters.</div>
              ) : (
                pageItems.map(a => <CardView key={a.id} asset={a} />)
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center gap-3 mt-8">
                <button disabled={pageSafe <= 1} onClick={() => setCurrentPage(p => Math.max(1, p-1))} className="flex items-center gap-2 px-5 py-2 rounded-2xl border border-zinc-800 disabled:opacity-40 hover:bg-zinc-900">
                  <ChevronLeft size={16} /> Previous
                </button>
                <div className="px-4 py-2 text-sm text-zinc-500">Page {pageSafe} / {totalPages}</div>
                <button disabled={pageSafe >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} className="flex items-center gap-2 px-5 py-2 rounded-2xl border border-zinc-800 disabled:opacity-40 hover:bg-zinc-900">
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}

            {loadingMore && (
              <div className="text-center mt-6 text-xs text-amber-400/80">
                Still fetching more Card NFT 2 cards in the background (page {loadedPages})…
              </div>
            )}
          </>
        )}

        {/* Trait browser - click to filter */}
        <div className="mt-12">
          <div className="section-label">Click any trait value to filter the entire collection</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Object.entries(traitIndex).sort((a,b) => a[0].localeCompare(b[0])).map(([trait, values]) => (
              <div key={trait} className="bg-zinc-950 border border-zinc-800 rounded-3xl p-4">
                <div className="text-xs font-medium text-amber-400/80 mb-2 tracking-widest">{trait.toUpperCase()}</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(values).sort((a,b) => b[1]-a[1]).slice(0, 12).map(([val, count]) => (
                    <button
                      key={val}
                      onClick={() => applyTraitFilter(trait, val)}
                      className="text-xs px-3 py-1 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-amber-600/40 transition"
                    >
                      {val} <span className="text-zinc-600">({count})</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detail Modal - traits are clickable */}
      {detail && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-[60] p-4" onClick={closeDetail}>
          <div className="modal bg-zinc-950 border border-zinc-800 rounded-3xl max-w-[980px] w-full overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col md:flex-row">
              <div className="md:w-5/12 bg-black p-8 flex items-center justify-center">
                {getImage(detail) ? (
                  <img src={getImage(detail)!} alt="" className="max-h-[520px] rounded-2xl shadow-2xl" />
                ) : <div className="text-zinc-700">No image</div>}
              </div>
              <div className="md:w-7/12 p-8">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-2xl font-semibold tracking-[-0.5px]">{detail?.content?.metadata?.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono break-all mt-0.5">{detail?.id}</div>
                  </div>
                  <button onClick={closeDetail} className="text-zinc-500 hover:text-white"><X /></button>
                </div>

                {detailListed && (
                  <a href={detailListed.url} target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2 rounded-2xl">
                    LISTED ON MARKETPLACES — {detailListed.priceSol.toFixed(2)} SOL <ExternalLink size={15} />
                  </a>
                )}

                <div className="mt-8">
                  <div className="text-xs tracking-[1.5px] text-amber-400 mb-3">TRAITS — click any to filter the binder</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(detailTraits).length > 0 ? (
                      Object.entries(detailTraits).map(([trait, value]) => (
                        <button
                          key={trait}
                          onClick={() => { applyTraitFilter(trait, value); closeDetail() }}
                          className="px-4 py-2 text-sm rounded-2xl border border-zinc-800 hover:border-amber-600/50 hover:bg-zinc-900 transition flex items-center gap-2"
                        >
                          {trait}: <span className="font-medium">{value}</span>
                        </button>
                      ))
                    ) : <div className="text-sm text-zinc-500">No traits.</div>}
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <button onClick={() => { Object.entries(detailTraits).forEach(([k,v]) => watchTrait(k,v)) }} className="px-6 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-semibold flex items-center gap-2">
                    <Bell size={18} /> Watch all traits on this card
                  </button>
                  {Object.entries(detailTraits).slice(0, 2).map(([k,v]) => (
                    <button key={k} onClick={() => watchTrait(k,v)} className="px-5 py-3 rounded-2xl border border-zinc-700 hover:bg-zinc-900 text-sm flex items-center gap-2">
                      Watch “{v}”
                    </button>
                  ))}
                </div>

        <div className="mt-6 text-[10px] text-zinc-500">
          Alerts fire when a new marketplace listing matches any watched trait.
        </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-[70] space-y-2">
        {toasts.map((t, i) => (
          <div key={i} className="bg-amber-400 text-black px-6 py-3.5 rounded-3xl shadow-2xl text-sm font-semibold max-w-xs">
            {t}
          </div>
        ))}
      </div>
    </div>
  )
}
