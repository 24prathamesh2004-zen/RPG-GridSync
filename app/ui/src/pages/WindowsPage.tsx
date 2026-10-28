import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ChevronDown, Clock3, RefreshCw, SlidersHorizontal, Zap } from 'lucide-react'
import { getTodaySignals, listPlants, type Plant, type Signal } from '../services/api'

type SignalMode = 'Combined' | 'Price' | 'Carbon' | 'Captive'
type BlockClass = 'good' | 'okay' | 'avoid'

interface PlantSignals {
  plant: Plant
  signals: Signal[]
  error?: string
}

interface ScoredBlock {
  signal: Signal
  quality: number
  category: BlockClass
}

interface WindowSummary {
  plant: Plant
  startIndex: number
  endIndex: number
  price: number
  carbon: number
  captive: number
  quality: number
  estimatedBlocks: number
}

const MODES: { id: SignalMode; label: string; detail: string }[] = [
  { id: 'Combined', label: 'Combined', detail: 'Balanced price, modeled carbon and renewable availability' },
  { id: 'Price', label: 'Price', detail: 'Lowest price blocks score best' },
  { id: 'Carbon', label: 'Carbon', detail: 'Lowest modeled carbon blocks score best' },
  { id: 'Captive', label: 'Captive', detail: 'Highest forecast solar/wind availability scores best' },
]

function istDateString(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function fmtTime(index: number) {
  const minuteOfDay = index * 15
  return `${String(Math.floor(minuteOfDay / 60) % 24).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
}

function fmtRange(start: number, end: number) {
  const endMinute = end * 15
  const endTime = `${String(Math.floor(endMinute / 60) % 24).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`
  return `${fmtTime(start)}–${endTime}`
}

function normalize(values: number[], higherIsBetter: boolean) {
  if (!values.length) return []
  const low = Math.min(...values)
  const high = Math.max(...values)
  const range = high - low
  if (range === 0) return values.map(() => 0.5)
  return values.map(value => higherIsBetter ? (value - low) / range : (high - value) / range)
}

function getQuality(signals: Signal[], mode: SignalMode) {
  const priceQuality = normalize(signals.map(signal => signal.price_rs_per_kwh), false)
  const carbonQuality = normalize(signals.map(signal => signal.carbon_kg_per_kwh), false)
  const captiveQuality = signals.map(signal => Math.max(0, Math.min(1, signal.captive_availability)))

  return signals.map((_, index) => {
    if (mode === 'Price') return priceQuality[index]
    if (mode === 'Carbon') return carbonQuality[index]
    if (mode === 'Captive') return captiveQuality[index]
    return 0.5 * priceQuality[index] + 0.3 * carbonQuality[index] + 0.2 * captiveQuality[index]
  })
}

function scoreBlocks(signals: Signal[], mode: SignalMode, goodPercent: number): ScoredBlock[] {
  const qualities = getQuality(signals, mode)
  const sorted = [...qualities].sort((a, b) => b - a)
  const count = Math.max(1, Math.floor(qualities.length * goodPercent / 100))
  const goodCutoff = sorted[count - 1] ?? 1
  const avoidCutoff = sorted[sorted.length - count] ?? 0

  return signals.map((signal, index) => {
    const quality = qualities[index]
    let category: BlockClass = 'okay'
    if (quality >= goodCutoff) category = 'good'
    else if (quality <= avoidCutoff) category = 'avoid'
    return { signal, quality, category }
  })
}

function getBestWindow(plantSignals: PlantSignals, mode: SignalMode): WindowSummary | null {
  if (plantSignals.signals.length < 16) return null
  const qualities = getQuality(plantSignals.signals, mode)
  let bestStart = 0
  let bestScore = -Infinity

  for (let start = 0; start <= qualities.length - 16; start += 1) {
    const score = qualities.slice(start, start + 16).reduce((sum, value) => sum + value, 0) / 16
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }

  const window = plantSignals.signals.slice(bestStart, bestStart + 16)
  const estimatedBlocks = window.filter(signal => signal.price_status !== 'fresh').length
  return {
    plant: plantSignals.plant,
    startIndex: bestStart,
    endIndex: bestStart + 16,
    price: window.reduce((sum, signal) => sum + signal.price_rs_per_kwh, 0) / window.length,
    carbon: window.reduce((sum, signal) => sum + signal.carbon_kg_per_kwh, 0) / window.length,
    captive: window.reduce((sum, signal) => sum + signal.captive_availability, 0) / window.length,
    quality: bestScore,
    estimatedBlocks,
  }
}

function signalSource(signals: Signal[]) {
  const sources = new Set(signals.map(signal => signal.price_source || 'unknown'))
  const hasEstimated = signals.some(signal => signal.price_status !== 'fresh')
  return { label: [...sources].join(', '), hasEstimated }
}

export default function WindowsPage() {
  const [plants, setPlants] = useState<PlantSignals[]>([])
  const [mode, setMode] = useState<SignalMode>('Combined')
  const [goodPercent, setGoodPercent] = useState(30)
  const [targetDate, setTargetDate] = useState(() => addDays(istDateString(new Date()), 1))
  const [selectedBlock, setSelectedBlock] = useState<{ plantId: number; index: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadSignals = async (showRefresh = false) => {
    showRefresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const response = await listPlants()
      const results = await Promise.all(response.data.map(async plant => {
        try {
          const signalResponse = await getTodaySignals(plant.id, targetDate)
          return { plant, signals: signalResponse.data.signals } satisfies PlantSignals
        } catch {
          return { plant, signals: [], error: 'Signals unavailable for this plant.' } satisfies PlantSignals
        }
      }))
      setPlants(results)
      setSelectedBlock(current => current && results.some(result => result.plant.id === current.plantId) ? current : null)
    } catch {
      setError('Could not load the plant register. Check the API connection and try again.')
      setPlants([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadSignals()
  }, [targetDate])

  const windows = useMemo(() => plants
    .map(plantSignals => getBestWindow(plantSignals, mode))
    .filter((window): window is WindowSummary => window !== null)
    .sort((a, b) => b.quality - a.quality), [plants, mode])

  const selected = selectedBlock
    ? plants.find(plant => plant.plant.id === selectedBlock.plantId)
    : undefined
  const selectedSignal = selected?.signals[selectedBlock?.index ?? -1]
  const successfulPlants = plants.filter(plant => plant.signals.length > 0).length
  const estimatedPriceBlocks = plants.reduce((sum, plant) => sum + plant.signals.filter(signal => signal.price_status !== 'fresh').length, 0)
  const sources = [...new Set(plants.flatMap(plant => plant.signals.map(signal => signal.price_source).filter(Boolean)))]

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Windows</h2>
          <p className="mt-1 text-sm text-gray-500">Compare tomorrow’s 15-minute operating windows across every registered plant.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-gray-500">
            Delivery date
            <span className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              <CalendarDays size={15} className="text-gray-400" />
              <input
                type="date"
                value={targetDate}
                onChange={event => setTargetDate(event.target.value)}
                className="border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
                aria-label="Delivery date"
              />
            </span>
          </label>
          <button
            onClick={() => void loadSignals(true)}
            disabled={loading || refreshing}
            title="Refresh plant signals"
            aria-label="Refresh plant signals"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {error && <div role="alert" className="border-l-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      <section aria-label="Signal view and coverage" className="grid grid-cols-2 divide-y divide-gray-100 border-y border-gray-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Plants with signals</div>
          <div className="mt-1 text-lg font-bold text-gray-900">{successfulPlants}<span className="ml-1 text-sm font-medium text-gray-400">/ {plants.length}</span></div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Blocks per plant</div>
          <div className="mt-1 text-lg font-bold text-gray-900">96<span className="ml-1 text-sm font-medium text-gray-400">× 15 min</span></div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Mode</div>
          <div className="mt-1 text-lg font-bold text-gray-900">{mode}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Estimated price blocks</div>
          <div className="mt-1 text-lg font-bold text-amber-700">{estimatedPriceBlocks.toLocaleString()}</div>
        </div>
      </section>

      <section className="space-y-4 border-y border-gray-200 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900">All-plant signal map</h3>
            <p className="mt-1 text-xs text-gray-500">{MODES.find(item => item.id === mode)?.detail}. Carbon and captive availability are modeled estimates.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label="Signal type">
              {MODES.map(item => (
                <button
                  key={item.id}
                  aria-pressed={mode === item.id}
                  onClick={() => setMode(item.id)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${mode === item.id ? 'bg-white text-zen-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <SlidersHorizontal size={14} />Good / avoid
              <select
                value={goodPercent}
                onChange={event => setGoodPercent(Number(event.target.value))}
                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
              >
                <option value={20}>Top/bottom 20%</option>
                <option value={30}>Top/bottom 30%</option>
                <option value={40}>Top/bottom 40%</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Good: top {goodPercent}%</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-300" />Middle</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-rose-300" />Avoid: bottom {goodPercent}%</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border-2 border-gray-800 bg-white" />Best 4-hour span</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm ring-2 ring-dashed ring-gray-700" />Selected block</span>
        </div>

        {loading ? (
          <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-gray-400"><RefreshCw size={16} className="animate-spin" />Loading all plant signals…</div>
        ) : plants.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No plants are available.</div>
        ) : (
          <div className="overflow-x-auto border-y border-gray-100 py-3">
            <div className="min-w-[1320px]">
              <div className="grid grid-cols-[190px_repeat(96,minmax(9px,1fr))] items-center gap-[2px] pb-2">
                <div className="sticky left-0 z-10 bg-gray-50 py-1 pr-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Plant · state</div>
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="col-span-4 text-center text-[9px] text-gray-400">{hour % 3 === 0 ? `${String(hour).padStart(2, '0')}:00` : ''}</div>
                ))}
              </div>
              <div className="space-y-1.5">
                {plants.map(({ plant, signals, error: plantError }) => {
                  if (plantError || signals.length < 96) {
                    return (
                      <div key={plant.id} className="grid grid-cols-[190px_1fr] items-center gap-2 rounded-md bg-gray-50 py-2 pr-2">
                        <div className="sticky left-0 bg-gray-50 pl-2 text-xs font-semibold text-gray-800">{plant.name}</div>
                        <div className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={13} />{plantError ?? `Only ${signals.length} of 96 blocks returned`}</div>
                      </div>
                    )
                  }
                  const scored = scoreBlocks(signals, mode, goodPercent)
                  const best = getBestWindow({ plant, signals }, mode)
                  const bestStart = best?.startIndex ?? -1
                  return (
                    <div key={plant.id} className="grid grid-cols-[190px_repeat(96,minmax(9px,1fr))] items-center gap-[2px]">
                      <div className="sticky left-0 z-10 min-w-0 bg-white py-1 pr-2">
                        <div className="truncate text-xs font-semibold text-gray-900">{plant.name}</div>
                        <div className="truncate text-[10px] text-gray-400">{plant.state} · Type {plant.archetype}</div>
                      </div>
                      {scored.map(({ signal, quality, category }, index) => {
                        const inBest = index >= bestStart && index < bestStart + 16
                        const isSelected = selectedBlock?.plantId === plant.id && selectedBlock.index === index
                        const time = signal.block_start_ist.slice(11, 16)
                        return (
                          <button
                            key={signal.block_start_ist}
                            type="button"
                            onClick={() => setSelectedBlock({ plantId: plant.id, index })}
                            aria-label={`${plant.name}, ${time} IST, ${category}, ${mode.toLowerCase()} quality ${(quality * 100).toFixed(0)} percent`}
                            title={`${plant.name} · ${time} IST · ${category} · price ₹${signal.price_rs_per_kwh.toFixed(2)}/kWh`}
                            className={`h-7 min-w-0 rounded-[3px] transition-[filter,transform] hover:z-20 hover:scale-y-110 hover:brightness-95 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zen-700 ${category === 'good' ? 'bg-emerald-500' : category === 'avoid' ? 'bg-rose-300' : 'bg-amber-300'} ${inBest ? 'border-y-[3px] border-gray-900' : 'border-y border-white/40'} ${index === bestStart ? 'rounded-l-sm border-l-[3px] border-gray-900' : ''} ${isSelected ? 'z-10 outline outline-2 outline-dashed outline-gray-800 outline-offset-1' : ''}`}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-gray-400">
          Colors rank blocks within each plant and date. The outlined run is the highest-scoring continuous 4-hour span in the selected mode. {sources.length ? `Price sources returned: ${sources.join(', ')}.` : ''} Carbon is CEA-factor/hour-shape modeled; captive availability is a weather proxy. No plant meter values are used.
        </p>
      </section>

      {selectedSignal && selected && selectedBlock && (
        <section aria-live="polite" className="grid grid-cols-1 gap-4 border-y border-gray-200 py-4 md:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900"><Clock3 size={15} className="text-zen-600" />Selected block · {selected.plant.name}</div>
            <p className="mt-1 text-xs text-gray-500">{targetDate} · {selectedSignal.block_start_ist.slice(11, 16)}–{fmtTime(selectedBlock.index + 1)} IST · {selectedSignal.tod_slot.replace('_', ' ')}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Price" value={`₹${selectedSignal.price_rs_per_kwh.toFixed(2)}/kWh`} tone="text-amber-700" />
              <Metric label="Carbon index" value={`${(selectedSignal.carbon_kg_per_kwh * 1000).toFixed(0)} g/kWh`} tone="text-teal-700" />
              <Metric label="Captive proxy" value={`${(selectedSignal.captive_availability * 100).toFixed(0)}%`} tone="text-emerald-700" />
              <Metric label={`${mode} rank score`} value={`${(scoreBlocks(selected.signals, mode, goodPercent)[selectedBlock.index]?.quality * 100).toFixed(0)}%`} tone="text-gray-800" />
            </div>
          </div>
          <div className="flex flex-col justify-center border-l border-gray-100 pl-4 text-xs leading-relaxed text-gray-500">
            <span className="font-semibold text-gray-800">Why this color?</span>
            <span className="mt-1">This block ranks as {scoreBlocks(selected.signals, mode, goodPercent)[selectedBlock.index]?.category} for {selected.plant.name} in {mode.toLowerCase()} mode. It is a relative ranking of modeled/public signals, not a statement about the plant’s measured demand or generation.</span>
            <span className="mt-1 text-[10px] text-gray-400">Price: {selectedSignal.price_source ?? 'source not reported'} · {selectedSignal.price_status ?? 'status unknown'}</span>
          </div>
        </section>
      )}

      <section className="space-y-3 border-b border-gray-200 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Best four-hour window per plant</h3>
            <p className="mt-1 text-xs text-gray-500">Continuous 16-block window ranked using {mode.toLowerCase()} mode; listed values are window averages.</p>
          </div>
          <div className="text-[10px] text-gray-400"><Zap size={12} className="mr-1 inline" />96 blocks · 15-minute resolution</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <th className="py-2 pr-3">Plant</th><th className="py-2 pr-3">Best span</th><th className="py-2 pr-3">Avg price</th><th className="py-2 pr-3">Modeled carbon</th><th className="py-2 pr-3">Captive proxy</th><th className="py-2">Price confidence</th>
              </tr>
            </thead>
            <tbody>
              {windows.map(window => (
                <tr key={window.plant.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/70">
                  <td className="py-2.5 pr-3 font-semibold text-gray-800">{window.plant.name}<div className="text-[10px] font-normal text-gray-400">{window.plant.state} · {window.plant.archetype}</div></td>
                  <td className="py-2.5 pr-3 font-semibold text-zen-700">{fmtRange(window.startIndex, window.endIndex)}</td>
                  <td className="py-2.5 pr-3 text-amber-800">₹{window.price.toFixed(2)}/kWh</td>
                  <td className="py-2.5 pr-3 text-teal-800">{(window.carbon * 1000).toFixed(0)} g/kWh</td>
                  <td className="py-2.5 pr-3 text-emerald-800">{(window.captive * 100).toFixed(0)}%</td>
                  <td className="py-2.5 text-xs">{window.estimatedBlocks ? <span className="text-amber-700">Estimated blocks in span: {window.estimatedBlocks}/16</span> : <span className="text-emerald-700">Fresh price blocks</span>}</td>
                </tr>
              ))}
              {!loading && windows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400">No plant has 96 usable signal blocks for this date.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className="border-l-2 border-gray-200 pl-2.5"><div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div><div className={`mt-0.5 text-sm font-bold ${tone}`}>{value}</div></div>
}
