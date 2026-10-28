import { useEffect, useState } from 'react'
import { AlertTriangle, FileText, Leaf, RefreshCw, TrendingUp } from 'lucide-react'
import {
  getImpactByPlant,
  getImpactOverview,
  getImpactByCompany,
  getValuePerKw,
  listPlants,
  type Plant,
} from '../services/api'

interface ImpactOverview {
  total_avoided_cost_rs: number
  total_avoided_co2_tonnes: number
  total_runs: number
  potential_saving_rs: number
  pending_recommendations: number
  approved_recommendations: number
}

interface PlantImpact {
  plant_id: number
  plant_name: string
  avoided_cost_rs: number
  avoided_co2_kg: number
  runs: number
  potential_saving_rs: number
  total_recommendations: number
}

interface CompanyImpact {
  company_id: number
  company_name: string
  avoided_cost_rs: number
  avoided_co2_kg: number
  runs: number
}

interface ValuePerKw {
  plant_name: string
  value_per_kw_per_year_rs: number
  avg_daily_saving_rs_per_kw: number
  note: string
}

function fmtRs(value: number) {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`
  if (value >= 1_000) return `₹${(value / 1_000).toFixed(1)} K`
  return `₹${value.toFixed(0)}`
}

function PlantOpportunity({ plants }: { plants: PlantImpact[] }) {
  const sorted = [...plants].sort((a, b) => b.potential_saving_rs - a.potential_saving_rs)
  const scale = Math.max(...sorted.flatMap(plant => [plant.potential_saving_rs, plant.avoided_cost_rs]), 1)

  if (!sorted.length) {
    return <p className="py-8 text-center text-sm text-gray-400">No plant-level impact data yet.</p>
  }

  return (
    <div className="space-y-4">
      {sorted.map(plant => (
        <div key={plant.plant_id}>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-gray-800">{plant.plant_name}</span>
            <span className="text-[11px] text-gray-500">
              {plant.runs} completed · {plant.total_recommendations} open
            </span>
          </div>
          <div className="grid grid-cols-[94px_1fr_auto] items-center gap-2 text-[11px]">
            <span className="text-gray-500">Booked estimate</span>
            <div className="h-2 overflow-hidden rounded-sm bg-gray-100">
              <div className="h-full bg-emerald-600" style={{ width: `${plant.avoided_cost_rs / scale * 100}%` }} />
            </div>
            <span className="min-w-16 text-right font-semibold text-emerald-800">{fmtRs(plant.avoided_cost_rs)}</span>
            <span className="text-gray-500">Open upside</span>
            <div className="h-2 overflow-hidden rounded-sm bg-gray-100">
              <div className="h-full bg-amber-400" style={{ width: `${plant.potential_saving_rs / scale * 100}%` }} />
            </div>
            <span className="min-w-16 text-right font-semibold text-amber-800">{fmtRs(plant.potential_saving_rs)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function CompanyTable({ companies }: { companies: CompanyImpact[] }) {
  if (!companies.length) {
    return <p className="px-4 py-8 text-center text-sm text-gray-400">No completed schedules recorded yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wide text-gray-400">
            <th className="px-4 py-2.5 text-left font-semibold">Company</th>
            <th className="px-4 py-2.5 text-right font-semibold">Booked estimate</th>
            <th className="px-4 py-2.5 text-right font-semibold">Per run</th>
            <th className="px-4 py-2.5 text-right font-semibold">CO₂ model</th>
          </tr>
        </thead>
        <tbody>
          {companies.map(company => (
            <tr key={company.company_id} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-3 font-semibold text-gray-800">{company.company_name}</td>
              <td className="px-4 py-3 text-right font-bold text-emerald-800">{fmtRs(company.avoided_cost_rs)}</td>
              <td className="px-4 py-3 text-right text-gray-600">
                {company.runs ? fmtRs(company.avoided_cost_rs / company.runs) : '—'}
              </td>
              <td className="px-4 py-3 text-right text-gray-600">{(company.avoided_co2_kg / 1000).toFixed(3)} t</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ImpactPage() {
  const [overview, setOverview] = useState<ImpactOverview | null>(null)
  const [plantsImpact, setPlantsImpact] = useState<PlantImpact[]>([])
  const [companies, setCompanies] = useState<CompanyImpact[]>([])
  const [plants, setPlants] = useState<Plant[]>([])
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null)
  const [valuePerKw, setValuePerKw] = useState<ValuePerKw | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [valueLoading, setValueLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    setRefreshing(true)
    setError('')
    try {
      const [overviewResponse, plantResponse, companyResponse, plantsResponse] = await Promise.all([
        getImpactOverview(),
        getImpactByPlant(),
        getImpactByCompany(),
        listPlants(),
      ])
      const availablePlants: Plant[] = plantsResponse.data
      setOverview(overviewResponse.data)
      setPlantsImpact(plantResponse.data as PlantImpact[])
      setCompanies(companyResponse.data as CompanyImpact[])
      setPlants(availablePlants)
      setSelectedPlant(current =>
        current ? availablePlants.find(plant => plant.id === current.id) ?? availablePlants[0] ?? null
          : availablePlants[0] ?? null,
      )
    } catch {
      setError('Impact data could not be loaded. Check the API connection and refresh.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (!selectedPlant) {
      setValuePerKw(null)
      return
    }
    let active = true
    setValueLoading(true)
    setValuePerKw(null)
    getValuePerKw(selectedPlant.id, 4)
      .then(response => { if (active) setValuePerKw(response.data as ValuePerKw) })
      .catch(() => { if (active) setValuePerKw(null) })
      .finally(() => { if (active) setValueLoading(false) })
    return () => { active = false }
  }, [selectedPlant])

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><RefreshCw size={22} className="animate-spin text-zen-500" /></div>
  }

  const booked = overview?.total_avoided_cost_rs ?? 0
  const potential = overview?.potential_saving_rs ?? 0
  const carbonTonnes = overview?.total_avoided_co2_tonnes ?? 0
  const completedRuns = overview?.total_runs ?? 0
  const activeUpsideCount = (overview?.pending_recommendations ?? 0) + (overview?.approved_recommendations ?? 0)
  const topOpportunity = [...plantsImpact].sort((a, b) => b.potential_saving_rs - a.potential_saving_rs)[0]

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Impact & economics</h2>
          <p className="mt-1 text-sm text-gray-500">Portfolio value, plant opportunity and accounting evidence.</p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Refresh impact data"
          aria-label="Refresh impact data"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </header>

      {error && <div role="alert" className="border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-3 border-y border-amber-200 bg-amber-50 px-4 py-3">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-700" />
        <div>
          <div className="text-sm font-semibold text-amber-900">Current impact values are model estimates, not meter-verified savings.</div>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
            Completing a schedule records its optimizer estimate. Carbon uses CEA factors and hourly proxies; reconcile against plant meter readings before external reporting.
          </p>
        </div>
      </div>

      <section aria-label="Portfolio impact summary" className="grid grid-cols-1 divide-y divide-gray-100 border-y border-gray-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Completed schedule value</div>
          <div className="mt-1 text-2xl font-bold text-emerald-800">{fmtRs(booked)}</div>
          <div className="mt-1 text-xs text-gray-500">Modelled estimate · {completedRuns} completed runs</div>
        </div>
        <div className="px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Actionable upside</div>
          <div className="mt-1 text-2xl font-bold text-amber-800">{fmtRs(potential)}</div>
          <div className="mt-1 text-xs text-gray-500">{activeUpsideCount} pending or approved schedules</div>
        </div>
        <div className="px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Carbon scenario</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-bold text-teal-800"><Leaf size={18} />{carbonTonnes.toFixed(3)} tCO₂</div>
          <div className="mt-1 text-xs text-gray-500">Modelled on completed schedules · location-based</div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)]">
        <div className="space-y-5">
          <section className="border-b border-gray-200 pb-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Plant opportunity profile</h3>
                <p className="mt-1 text-xs text-gray-500">Compare completed schedule estimates with still-actionable upside.</p>
              </div>
              <div className="flex gap-3 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><i className="h-2 w-2 bg-emerald-600" />Completed estimate</span>
                <span className="flex items-center gap-1"><i className="h-2 w-2 bg-amber-400" />Pending / approved</span>
              </div>
            </div>
            <PlantOpportunity plants={plantsImpact} />
          </section>

          <section className="border-b border-gray-200 pb-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Company economics</h3>
                <p className="mt-1 text-xs text-gray-500">Per-run average helps compare realized schedule economics across companies.</p>
              </div>
              <TrendingUp size={16} className="text-emerald-700" />
            </div>
            <CompanyTable companies={companies} />
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border-b border-gray-200 pb-5">
            <h3 className="text-sm font-bold text-gray-900">Value per flexible kW</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">Annualized tariff and market-price shifting estimate; separate from realized plant value.</p>
            <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-gray-400" htmlFor="impact-plant">Plant</label>
            <select
              id="impact-plant"
              value={selectedPlant?.id ?? ''}
              onChange={event => setSelectedPlant(plants.find(plant => plant.id === Number(event.target.value)) ?? null)}
              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
            >
              {plants.map(plant => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
            </select>
            {valueLoading ? (
              <div className="flex items-center gap-2 py-5 text-xs text-gray-400"><RefreshCw size={13} className="animate-spin" />Calculating estimate…</div>
            ) : valuePerKw ? (
              <div className="mt-3 grid grid-cols-2 divide-x divide-gray-200 border-y border-gray-200 py-3">
                <div className="pr-3">
                  <div className="text-lg font-bold text-zen-700">{fmtRs(valuePerKw.value_per_kw_per_year_rs)}</div>
                  <div className="mt-0.5 text-[10px] text-gray-500">per kW / year</div>
                </div>
                <div className="pl-3">
                  <div className="text-lg font-bold text-gray-800">{fmtRs(valuePerKw.avg_daily_saving_rs_per_kw)}</div>
                  <div className="mt-0.5 text-[10px] text-gray-500">per kW / day</div>
                </div>
              </div>
            ) : (
              <p className="py-4 text-xs text-gray-400">Value estimate is unavailable for this plant.</p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
              {valuePerKw?.note ?? 'Indicative only; scale by the plant’s flexible load and validate against its tariff and operating data.'}
            </p>
          </section>

          <section className="border-b border-gray-200 pb-5">
            <h3 className="text-sm font-bold text-gray-900">Portfolio readout</h3>
            {topOpportunity && topOpportunity.potential_saving_rs > 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                <strong className="text-gray-900">{topOpportunity.plant_name}</strong> has the largest open estimate at{' '}
                <strong className="text-amber-800">{fmtRs(topOpportunity.potential_saving_rs)}</strong>.
                {' '}Review its pending schedules to convert modeled upside into operating decisions.
              </p>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-gray-600">No pending or approved opportunity is currently recorded across the portfolio.</p>
            )}
            <p className="mt-2 text-[10px] text-gray-400">Open opportunity excludes completed and rejected schedules.</p>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900"><FileText size={15} className="text-gray-500" />Method and evidence</div>
            <dl className="space-y-2 text-xs leading-relaxed">
              <div><dt className="font-semibold text-gray-700">Cost</dt><dd className="text-gray-500">Optimizer’s price-window estimate versus its assumed original schedule.</dd></div>
              <div><dt className="font-semibold text-gray-700">Carbon</dt><dd className="text-gray-500">CEA baseline factors with hourly grid and renewable proxies; not a plant-specific emissions inventory.</dd></div>
              <div><dt className="font-semibold text-gray-700">Evidence gap</dt><dd className="text-gray-500">No meter reconciliation is performed when a schedule is marked complete.</dd></div>
            </dl>
          </section>
        </aside>
      </section>
    </div>
  )
}
