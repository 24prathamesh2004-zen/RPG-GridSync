import { useEffect, useState, useCallback } from 'react'
import {
  Zap, Leaf, AlertTriangle, ArrowRight, RefreshCw,
  Sun, Wind, TrendingDown, TrendingUp, Clock, ChevronRight,
} from 'lucide-react'
import { listPlants, getImpactOverview, getTodaySignals, listRecommendations, type Plant } from '../services/api'
import { useNavigate } from 'react-router-dom'

// ── Types ──────────────────────────────────────────────────────────────────────
interface SignalBlock {
  block_start_ist: string
  price_rs_per_kwh: number
  carbon_kg_per_kwh: number
  captive_availability: number
  window_score: number
  tod_slot: string
}
interface Summary {
  avg_price_rs_per_kwh: number
  min_price_rs_per_kwh: number
  max_price_rs_per_kwh: number
  avg_carbon_kg_per_kwh: number
  best_window_start: string
  peak_blocks: number
  solar_rebate_blocks: number
  night_rebate_blocks: number
  price_range_rs_per_kwh: number
}

const ARCHETYPE_LABEL: Record<string, string> = {
  A: 'Utility only',
  B: 'Utility + Rooftop Solar',
  C: 'Utility + Captive / Open Access',
}
const ARCHETYPE_COLOR: Record<string, string> = {
  A: 'bg-gray-100 text-gray-600',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-emerald-100 text-emerald-700',
}
const SOURCE_COLOR: Record<string, string> = {
  utility:        '#6366f1',
  rooftop_solar:  '#f59e0b',
  captive_hybrid: '#10b981',
  captive_solar:  '#34d399',
  captive_wind:   '#06b6d4',
  ppa:            '#8b5cf6',
  open_access:    '#3b82f6',
}
const SOURCE_LABEL: Record<string, string> = {
  utility:        'Utility',
  rooftop_solar:  'Rooftop Solar',
  captive_hybrid: 'Captive Hybrid',
  captive_solar:  'Captive Solar',
  captive_wind:   'Captive Wind',
  ppa:            'Green PPA',
  open_access:    'Open Access',
}

function fmtTime(iso: string) { return iso.slice(11, 16) }
function fmtRs(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`
  if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}K`
  return `₹${v.toFixed(0)}`
}

// ── Signal chart (SVG) ─────────────────────────────────────────────────────────
function SignalChart({ signals, summary }: { signals: SignalBlock[]; summary: Summary }) {
  if (!signals.length) return null
  const W = 700, H = 180, PL = 44, PT = 10, PB = 28, PR = 8
  const cW = W - PL - PR, cH = H - PT - PB

  const prices  = signals.map(s => s.price_rs_per_kwh)
  const carbons = signals.map(s => s.carbon_kg_per_kwh * 1000) // g/kWh for scale
  const caps    = signals.map(s => s.captive_availability)

  const pMin = Math.min(...prices),   pMax = Math.max(...prices)
  const cMin = Math.min(...carbons),  cMax = Math.max(...carbons)

  const xOf = (i: number) => PL + (i / (signals.length - 1)) * cW
  const yP   = (v: number) => PT + (1 - (v - pMin) / (pMax - pMin || 1)) * cH
  const yC   = (v: number) => PT + (1 - (v - cMin) / (cMax - cMin || 1)) * cH

  // Captive area polygon
  const capPts = [
    `${xOf(0)},${PT + cH}`,
    ...caps.map((v, i) => `${xOf(i)},${PT + (1 - v) * cH}`),
    `${xOf(caps.length - 1)},${PT + cH}`,
  ].join(' ')

  // Polylines
  const pricePoints = prices.map((v, i) => `${xOf(i)},${yP(v)}`).join(' ')
  const carbPoints  = carbons.map((v, i) => `${xOf(i)},${yC(v)}`).join(' ')

  // Hour labels every 4 blocks (1 hour)
  const hourLabels: { x: number; label: string }[] = []
  signals.forEach((s, i) => {
    if (i % 4 === 0) {
      const h = parseInt(s.block_start_ist.slice(11, 13))
      if (h % 4 === 0) hourLabels.push({ x: xOf(i), label: `${h.toString().padStart(2, '0')}:00` })
    }
  })

  // Best window highlight (lowest score, 8 blocks = 2h)
  const scores = signals.map(s => s.window_score)
  const bestIdx = scores.indexOf(Math.min(...scores))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="overflow-visible" role="img" aria-label="Price, carbon and captive signals">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={PL} x2={W - PR} y1={PT + f * cH} y2={PT + f * cH} stroke="#f1f5f9" strokeWidth="1" />
      ))}
      {/* Hour verticals */}
      {hourLabels.map(({ x, label }) => (
        <g key={label}>
          <line x1={x} x2={x} y1={PT} y2={PT + cH} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
          <text x={x} y={H - 4} textAnchor="middle" fontSize={10} fill="#94a3b8">{label}</text>
        </g>
      ))}
      {/* Captive availability area */}
      <polygon points={capPts} fill="#d1fae5" fillOpacity="0.55" />
      {/* Best window highlight */}
      <rect x={xOf(Math.max(0, bestIdx - 4))} y={PT} width={xOf(bestIdx + 4) - xOf(Math.max(0, bestIdx - 4))} height={cH}
            fill="#6366f1" fillOpacity="0.08" rx="4" />
      {/* Carbon line */}
      <polyline points={carbPoints} fill="none" stroke="#10b981" strokeWidth="1.8" strokeLinejoin="round" />
      {/* Price line */}
      <polyline points={pricePoints} fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinejoin="round" />
      {/* Y-axis labels */}
      <text x={PL - 4} y={PT + 8}     textAnchor="end" fontSize={10} fill="#94a3b8">{pMax.toFixed(1)}</text>
      <text x={PL - 4} y={PT + cH}    textAnchor="end" fontSize={10} fill="#94a3b8">{pMin.toFixed(1)}</text>
      <text x={PL - 4} y={PT + cH/2}  textAnchor="end" fontSize={10} fill="#94a3b8" transform={`rotate(-90,${PL-30},${PT+cH/2})`}>₹/kWh</text>
    </svg>
  )
}

// ── Best windows table ─────────────────────────────────────────────────────────
function BestWindows({ allSignals }: { allSignals: Record<number, { plant: Plant; signals: SignalBlock[]; summary: Summary }> }) {
  const rows: { plant: Plant; start: string; end: string; price: number; carbon: number; driver: string; score: number }[] = []

  Object.values(allSignals).forEach(({ plant, signals }) => {
    if (!signals.length) return
    const runBlocks = 16 // 4 hours
    let best = { score: Infinity, idx: 0 }
    for (let i = 0; i <= signals.length - runBlocks; i++) {
      const w = signals.slice(i, i + runBlocks)
      const s = w.reduce((a, b) => a + b.window_score, 0) / runBlocks
      if (s < best.score) best = { score: s, idx: i }
    }
    const window = signals.slice(best.idx, best.idx + runBlocks)
    const avgPrice  = window.reduce((a, b) => a + b.price_rs_per_kwh, 0) / runBlocks
    const avgCarbon = window.reduce((a, b) => a + b.carbon_kg_per_kwh, 0) / runBlocks
    const slot = signals[best.idx]?.tod_slot ?? ''
    const driver = plant.archetype === 'C'
      ? 'Captive + tariff'
      : plant.archetype === 'B'
      ? 'Rooftop output + tariff'
      : slot === 'solar_rebate' ? 'Solar-hour rebate'
      : slot === 'night_rebate' ? 'Night rebate'
      : 'ToD tariff'
    rows.push({ plant, start: signals[best.idx].block_start_ist, end: signals[best.idx + runBlocks - 1].block_start_ist, price: avgPrice, carbon: avgCarbon, driver, score: best.score })
  })

  rows.sort((a, b) => a.score - b.score)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {['Plant', 'Archetype', 'Best 4-hr window', 'Avg price', 'Avg carbon', 'Driver'].map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.plant.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
              <td className="px-4 py-3 font-semibold text-gray-900">{r.plant.name}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${ARCHETYPE_COLOR[r.plant.archetype]}`}>
                  {r.plant.archetype}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-sm text-zen-700 font-semibold">
                {fmtTime(r.start)} – {fmtTime(r.end)}
              </td>
              <td className="px-4 py-3 text-amber-700 font-semibold">₹{r.price.toFixed(2)}/kWh</td>
              <td className="px-4 py-3 text-emerald-700 font-semibold">{(r.carbon * 1000).toFixed(0)} gCO₂/kWh</td>
              <td className="px-4 py-3">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{r.driver}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const navigate = useNavigate()
  const [plants, setPlants]         = useState<Plant[]>([])
  const [impact, setImpact]         = useState<any>(null)
  const [selected, setSelected]     = useState<Plant | null>(null)
  const [sigData, setSigData]       = useState<{ signals: SignalBlock[]; summary: Summary } | null>(null)
  const [allSignals, setAllSignals] = useState<Record<number, { plant: Plant; signals: SignalBlock[]; summary: Summary }>>({})
  const [pendingRecs, setPendingRecs] = useState<any[]>([])
  const [sigLoading, setSigLoading] = useState(false)
  const [loading, setLoading]       = useState(true)
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  // Load plants + impact together
  useEffect(() => {
    Promise.all([
      fetch('/api/v1/plants/').then(r => r.json()),
      fetch('/api/v1/impact/overview').then(r => r.json()),
    ]).then(([pl, imp]) => {
      setPlants(pl)
      setImpact(imp)
      if (pl.length > 0) setSelected(pl[0])
    }).finally(() => setLoading(false))
  }, [])

  // Load signals for selected plant
  useEffect(() => {
    if (!selected) return
    setSigLoading(true)
    fetch(`/api/v1/signals/${selected.id}/today`)
      .then(r => r.json())
      .then(d => {
        setSigData({ signals: d.signals ?? [], summary: d.summary })
        setAllSignals(prev => ({ ...prev, [selected.id]: { plant: selected, signals: d.signals ?? [], summary: d.summary } }))
      })
      .finally(() => setSigLoading(false))
  }, [selected])

  // Load all plant signals for windows table (background)
  useEffect(() => {
    plants.forEach(p => {
      if (allSignals[p.id]) return
      fetch(`/api/v1/signals/${p.id}/today`)
        .then(r => r.json())
        .then(d => setAllSignals(prev => ({ ...prev, [p.id]: { plant: p, signals: d.signals ?? [], summary: d.summary } })))
        .catch(() => {})
    })
  }, [plants])

  // Load pending recs
  useEffect(() => {
    if (!selected) return
    fetch(`/api/v1/recommendations/${selected.id}?status=pending`)
      .then(r => r.json())
      .then(d => setPendingRecs(Array.isArray(d) ? d.slice(0, 4) : []))
      .catch(() => {})
  }, [selected])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={24} className="text-zen-400 animate-spin" />
      </div>
    )
  }

  const chainSteps = impact ? [
    { n: '1 · Loads shifted',     v: impact.total_runs > 0 ? `${impact.total_runs}` : '—',
      sub: impact.total_runs > 0 ? 'completed runs' : 'no runs yet', color: 'text-gray-900' },
    { n: '2 · Power bill saving', v: impact.total_avoided_cost_rs > 0 ? fmtRs(impact.total_avoided_cost_rs) : '—',
      sub: impact.total_avoided_cost_rs > 0 ? 'verified, completed runs' : 'starts after first run', color: 'text-green-700' },
    { n: '3 · Potential saving',  v: impact.potential_saving_rs > 0 ? fmtRs(impact.potential_saving_rs) : '—',
      sub: impact.potential_saving_rs > 0 ? 'if all recs executed' : 'generate recs on Schedule', color: 'text-amber-700' },
    { n: '4 · Carbon avoided',    v: impact.total_avoided_co2_kg > 0 ? `${((impact.total_avoided_co2_kg) / 1000).toFixed(3)} t` : '—',
      sub: 'CO₂ avoided, modelled', color: 'text-emerald-700' },
    { n: '5 · Pending actions',   v: `${impact.pending_recommendations ?? 0}`,
      sub: impact.pending_recommendations > 0 ? 'awaiting your decision' : 'nothing pending', color: impact.pending_recommendations > 0 ? 'text-red-600' : 'text-gray-400' },
  ] : []

  const bestSlot = sigData?.summary?.best_window_start
    ? fmtTime(sigData.summary.best_window_start)
    : '—'

  const slotCounts = sigData?.summary
  const priceRange = sigData?.summary?.price_range_rs_per_kwh ?? 0

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
          <p className="text-sm text-gray-400 mt-0.5">{today} · Public grid signals live</p>
        </div>
        {impact?.pending_recommendations > 0 && (
          <button
            onClick={() => navigate('/schedule')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors"
          >
            <AlertTriangle size={13} />
            {impact.pending_recommendations} pending — go to Schedule
            <ChevronRight size={13} />
          </button>
        )}
      </div>

      {/* ── Value chain ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 rounded-2xl overflow-hidden border border-gray-200 bg-white">
        {chainSteps.map((s, i) => (
          <div key={i} className={`px-4 py-4 ${i < 4 ? 'border-r border-gray-100' : 'bg-gradient-to-br from-green-50 to-emerald-50'}`}>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{s.n}</div>
            <div className={`text-2xl font-extrabold tracking-tight ${s.color}`}>{s.v}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Plant selector ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {plants.map(p => (
          <button
            key={p.id}
            onClick={() => setSelected(p)}
            className={`group relative flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all ${
              selected?.id === p.id
                ? 'bg-zen-600 border-zen-600 text-white shadow-md shadow-zen-200'
                : 'bg-white border-gray-200 text-gray-700 hover:border-zen-300 hover:shadow-sm'
            }`}
          >
            {/* Power source dots */}
            <div className="flex gap-0.5">
              {p.power_sources.slice(0, 3).map((src, si) => (
                <span key={si} className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLOR[src] ?? '#94a3b8' }} />
              ))}
            </div>
            {p.name}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              selected?.id === p.id
                ? 'bg-white/20 text-white'
                : ARCHETYPE_COLOR[p.archetype]
            }`}>{p.archetype}</span>
          </button>
        ))}
      </div>

      {/* ── Main 2-column section ───────────────────────────────────────────── */}
      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left col: signal chart */}
          <div className="lg:col-span-2 space-y-4">
            {/* Chart card */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-bold text-gray-900">{selected.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{selected.state} · {selected.utility || '—'} · {ARCHETYPE_LABEL[selected.archetype]}</div>
                </div>
                {sigLoading && <RefreshCw size={14} className="text-gray-300 animate-spin mt-1" />}
              </div>

              {/* Quick stats row */}
              {sigData?.summary && (
                <div className="grid grid-cols-4 gap-2 mb-4">
                  <MiniStat label="Best window" value={`${bestSlot} IST`} color="text-zen-700" highlight />
                  <MiniStat label="Price range" value={`₹${priceRange.toFixed(2)}/kWh`} color="text-amber-700" />
                  <MiniStat label="Peak hours" value={`${slotCounts?.peak_blocks ?? 0} blocks`} color="text-red-600" />
                  <MiniStat label="Solar rebate" value={`${slotCounts?.solar_rebate_blocks ?? 0} blocks`} color="text-emerald-600" />
                </div>
              )}

              {sigData?.signals.length ? (
                <>
                  <SignalChart signals={sigData.signals} summary={sigData.summary} />
                  {/* Legend */}
                  <div className="flex flex-wrap gap-4 mt-3">
                    {[
                      { color: '#f59e0b', label: 'Price (₹/kWh)' },
                      { color: '#10b981', label: 'Carbon index (gCO₂/kWh)' },
                      { color: '#d1fae5', label: 'Captive/solar availability', border: '#10b981' },
                      { color: '#6366f1', label: 'Best window', opacity: 0.15 },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        <span className="w-3 h-2 rounded-sm inline-block border"
                          style={{ background: l.color, opacity: l.opacity ?? 1, borderColor: l.border ?? 'transparent' }} />
                        {l.label}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-32 flex items-center justify-center text-gray-300 text-sm">Loading signals…</div>
              )}
            </div>

            {/* Power source mix */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="font-semibold text-gray-900 text-sm mb-3">Power source mix</div>
              <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                {selected.power_sources.map((src, i) => (
                  <div key={i} className="flex-1 rounded-sm transition-all" style={{ background: SOURCE_COLOR[src] ?? '#94a3b8' }}
                    title={SOURCE_LABEL[src] ?? src} />
                ))}
                {selected.power_sources.length === 0 && (
                  <div className="flex-1 rounded-full" style={{ background: SOURCE_COLOR.utility }} />
                )}
              </div>
              <div className="flex flex-wrap gap-3 mt-3">
                {(selected.power_sources.length ? selected.power_sources : ['utility']).map((src, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: SOURCE_COLOR[src] ?? '#94a3b8' }} />
                    {SOURCE_LABEL[src] ?? src}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right col: attention + pending recs */}
          <div className="space-y-4">
            {/* Needs attention */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="font-bold text-gray-900 mb-1 text-sm">Needs attention</div>
              <div className="text-xs text-gray-400 mb-3">Only what needs a decision today.</div>
              <div className="space-y-0">
                {[
                  { color: '#6366f1', title: 'Best window today', detail: `${bestSlot} IST — lowest price + carbon for ${selected.name}`, urgent: false },
                  impact?.pending_recommendations > 0 && {
                    color: '#f59e0b',
                    title: `${impact.pending_recommendations} recommendations pending`,
                    detail: 'Tap Approve or Reject on the Schedule page',
                    urgent: true,
                  },
                  sigData?.summary && sigData.summary.peak_blocks > 8 && {
                    color: '#ef4444',
                    title: `${sigData.summary.peak_blocks} blocks in peak tariff`,
                    detail: 'Schedule flexible loads away from peak hours',
                    urgent: true,
                  },
                  selected.archetype === 'C' && {
                    color: '#10b981',
                    title: 'Captive window available',
                    detail: 'Solar/wind generation high around midday — prioritise loads then',
                    urgent: false,
                  },
                  priceRange > 0.5 && {
                    color: '#f59e0b',
                    title: `₹${priceRange.toFixed(2)}/kWh price spread today`,
                    detail: 'High spread = larger shifting opportunity',
                    urgent: false,
                  },
                ].filter(Boolean).slice(0, 5).map((item: any, i) => (
                  <div key={i} className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: item.color }} />
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{item.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pending recommendations for this plant */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-gray-900 text-sm">Today's recommendations</div>
                <button onClick={() => navigate('/schedule')} className="text-xs text-zen-600 font-semibold flex items-center gap-0.5 hover:text-zen-800">
                  All <ChevronRight size={12} />
                </button>
              </div>
              {pendingRecs.length === 0 ? (
                <div className="text-center py-4">
                  <Clock size={24} className="text-gray-200 mx-auto mb-2" />
                  <p className="text-xs text-gray-400">No pending recs for this plant.</p>
                  <button onClick={() => navigate('/schedule')} className="mt-2 text-xs text-zen-600 font-semibold">
                    Generate on Schedule page →
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingRecs.map(rec => (
                    <div key={rec.id} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold text-gray-800 leading-snug">{rec.load_name}</div>
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">pending</span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 font-mono">
                        {fmtTime(rec.recommended_start)} – {fmtTime(rec.recommended_end)} IST
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="flex items-center gap-0.5 text-[11px] text-green-700 font-semibold">
                          <TrendingDown size={11} /> ₹{rec.estimated_saving_rs.toFixed(0)}
                        </span>
                        <span className="flex items-center gap-0.5 text-[11px] text-emerald-600 font-semibold">
                          <Leaf size={11} /> {rec.estimated_carbon_saving_kg.toFixed(1)} kgCO₂
                        </span>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => navigate('/schedule')}
                    className="w-full mt-1 py-2 rounded-xl border border-zen-200 text-zen-700 text-xs font-semibold hover:bg-zen-50 transition-colors flex items-center justify-center gap-1"
                  >
                    Review & approve <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tomorrow's best windows (all plants) ───────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Zap size={15} className="text-zen-500" />
          <span className="font-bold text-gray-900 text-sm">Best 4-hour windows today — all plants</span>
          <span className="ml-auto text-[10px] text-gray-400">Lowest combined price + carbon score</span>
        </div>
        {Object.keys(allSignals).length >= 2 ? (
          <BestWindows allSignals={allSignals} />
        ) : (
          <div className="px-5 py-6 text-sm text-gray-400">Loading signals for all plants…</div>
        )}
      </div>

      {/* ── Data health footer ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] text-gray-400 font-medium">Data sources:</span>
        {[
          { label: 'IEX prices', ok: true },
          { label: 'CEA emission factor', ok: true },
          { label: 'Open-Meteo weather', ok: true },
          { label: 'Plant meter data', ok: false, note: 'upload needed' },
        ].map(s => (
          <span key={s.label} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {s.ok ? '✓' : '○'} {s.label}{s.note ? ` (${s.note})` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

function MiniStat({ label, value, color, highlight }: { label: string; value: string; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${highlight ? 'bg-zen-50 border border-zen-100' : 'bg-gray-50'}`}>
      <div className="text-[10px] text-gray-400 font-medium">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  )
}
