import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowDownRight, ArrowRight, Clock3, Factory, Gauge, Leaf, Radio, Zap } from 'lucide-react'
import {
  blockCarbon,
  blockLabel,
  blockPrice,
  dispatchForPlant,
  deterministic,
  estimatedPlantDemand,
  frequencyBandRank,
  gridFrequency,
  hourLabel,
  plantFrequency,
  plants,
  regions,
  supplierAvailability,
  supplierEmissions,
  supplierPrice,
  suppliers,
  type Region,
  type RpgPlant,
  type SupplierPlant,
  type SupplierType,
} from './commandCenterData'

type CompanyFilter = '' | 'CEAT' | 'KEC'

type Series = { label: string; color: string; values: number[]; dashed?: boolean }

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`
const frequencyStatus = (value: number): { label: string; tone: 'good' | 'warn' | 'bad' } => Math.abs(value - 50) <= 0.03
  ? { label: 'In band', tone: 'good' }
  : Math.abs(value - 50) <= 0.05
    ? { label: 'Watch', tone: 'warn' }
    : { label: 'Low', tone: 'bad' }

function Chart({ series, min, max, selected, band, suffix = '', height = 190 }: {
  series: Series[]; min: number; max: number; selected?: number; band?: [number, number]; suffix?: string; height?: number
}) {
  const width = 720
  const left = 42
  const right = width - 10
  const top = 10
  const bottom = height - 26
  const x = (index: number) => left + index * (right - left) / 95
  const y = (value: number) => bottom - (value - min) / (max - min || 1) * (bottom - top)
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Time series chart" className="min-w-[560px]">
        {band && <rect x={left} y={y(band[1])} width={right - left} height={y(band[0]) - y(band[1])} rx="4" fill="#dcf2e5" />}
        {[0, 1, 2, 3].map(index => {
          const value = min + (max - min) * index / 3
          return <g key={index}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e7edf3" /><text x={left - 7} y={y(value) + 3} textAnchor="end" fontSize="10" fill="#718096">{value.toFixed(1)}{suffix}</text></g>
        })}
        {[0, 12, 24, 36, 48, 60, 72, 84].map(block => <text key={block} x={x(block)} y={height - 5} textAnchor="middle" fontSize="10" fill="#718096">{hourLabel(block / 4)}</text>)}
        {series.map(item => {
          const points = item.values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
          return <path key={item.label} d={points} fill="none" stroke={item.color} strokeWidth={item.dashed ? 1.8 : 2.4} strokeDasharray={item.dashed ? '5 4' : undefined} strokeLinejoin="round" />
        })}
        {selected !== undefined && <line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} stroke="#245a86" strokeWidth="2" />}
      </svg>
    </div>
  )
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'teal' }) {
  const color = { good: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-rose-100 text-rose-800', neutral: 'bg-slate-100 text-slate-600', teal: 'bg-teal-100 text-teal-800' }[tone]
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>{children}</span>
}

export default function CommandCenterPage({ companyFilter, onCompanyFilter }: { companyFilter: CompanyFilter; onCompanyFilter: (value: CompanyFilter) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const [block, setBlock] = useState(() => {
    const value = Number(new URLSearchParams(location.search).get('block'))
    return Number.isInteger(value) && value >= 0 && value <= 95 ? value : 58
  })
  const [approved, setApproved] = useState<string[]>([])
  const [mode, setMode] = useState<'Advisory mode' | 'Automated mode'>(() => localStorage.getItem('gridsync-agent-mode') === 'automated' ? 'Automated mode' : 'Advisory mode')
  const changeBlock = (value: number) => {
    setBlock(value)
    navigate({ search: `?block=${value}` }, { replace: true })
  }
  const companyPlants = useMemo(() => plants.filter(plant => !companyFilter || plant.company === companyFilter), [companyFilter])
  const visibleSuppliers = useMemo(() => suppliers.filter(supplier => supplier.region === 'All' || companyPlants.some(plant => plant.region === supplier.region)), [companyPlants])
  const path = location.pathname
  const plantId = params.plantId
  const supplierId = params.supplierId
  const selectedPlant = plants.find(plant => plant.id === plantId)
  const selectedSupplier = suppliers.find(supplier => supplier.id === supplierId)
  const activePlants = companyPlants
  const totalFlexible = activePlants.reduce((sum, plant) => sum + plant.flexibleMw, 0)
  const totalSaving = activePlants.reduce((sum, plant) => sum + plant.loads.reduce((loadSum, load) => loadSum + estimateLoadSaving(plant, load.currentHour, load.hours, Math.max(6, load.allowedStart), load.kw), 0), 0)
  const totalCarbon = activePlants.reduce((sum, plant) => sum + plant.loads.reduce((loadSum, load) => loadSum + estimateLoadCarbon(plant, load.currentHour, load.hours, Math.max(6, load.allowedStart), load.kw), 0), 0)
  const cheapestNow = [...activePlants].sort((a, b) => blockPrice(a, block) - blockPrice(b, block))[0]

  const title = path.startsWith('/plants/') ? `${selectedPlant?.company ?? ''} ${selectedPlant?.name ?? 'Plant'}`
    : path.startsWith('/suppliers/') ? selectedSupplier?.name ?? 'Supplier'
      : path === '/plants' ? 'RPG Plants'
        : path === '/suppliers' ? 'Supplier Plants'
          : path === '/frequency' ? 'Frequency'
            : path === '/meters' ? 'Meter Readings' : 'Overview'
  const subtitle = path.startsWith('/plants/') ? 'Plant operations, source dispatch, frequency and load windows'
    : path.startsWith('/suppliers/') ? 'Supplier dispatch profile and connected RPG sites'
      : ({ '/': 'Group demand, supplier dispatch, plant operations and tomorrow’s plan', '/plants': 'Nine RPG plants across four grid regions', '/suppliers': 'Supplier plants and market sources serving RPG sites', '/frequency': 'Grid frequency against each RPG plant and supplier', '/meters': 'Plant incomers and supplier injection meters' } as Record<string, string>)[path] ?? 'Command Center'

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="sticky top-0 z-30 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:-mx-[26px] md:px-[26px]">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          {path.startsWith('/plants/') || path.startsWith('/suppliers/') ? <><button onClick={() => navigate(path.startsWith('/plants/') ? '/plants' : '/suppliers')} className="text-teal-700 hover:underline">{path.startsWith('/plants/') ? 'RPG Plants' : 'Supplier Plants'}</button><span>›</span></> : null}
          <span className="text-slate-900">{title}</span>
          <span className="hidden sm:inline text-slate-400">· {subtitle}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="command-company">Company scope</label>
          <select id="command-company" value={companyFilter} onChange={event => onCompanyFilter(event.target.value as CompanyFilter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
            <option value="">All companies</option><option value="CEAT">CEAT</option><option value="KEC">KEC International</option>
          </select>
          <select aria-label="Operating mode" value={mode} onChange={event => {
            const nextMode = event.target.value as typeof mode
            setMode(nextMode)
            localStorage.setItem('gridsync-agent-mode', nextMode === 'Automated mode' ? 'automated' : 'advisory')
            window.dispatchEvent(new Event('gridsync-mode-change'))
          }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
            <option>Advisory mode</option><option>Automated mode</option>
          </select>
          <Pill tone="warn">Demo data</Pill>
        </div>
      </div>

      {path === '/' && <Overview plants={activePlants} totalFlexible={totalFlexible} totalSaving={totalSaving} totalCarbon={totalCarbon} cheapestNow={cheapestNow} block={block} approved={approved} onApprove={id => setApproved(current => [...current, id])} onPlant={id => navigate(`/plants/${id}`)} onSupplier={id => navigate(`/suppliers/${id}`)} onSchedule={() => navigate('/schedule')} />}
      {path === '/plants' && <PlantList plants={activePlants} block={block} onPlant={id => navigate(`/plants/${id}`)} />}
      {path.startsWith('/plants/') && selectedPlant && <PlantDetail plant={selectedPlant} block={block} setBlock={changeBlock} approved={approved} onApprove={id => setApproved(current => [...current, id])} onSupplier={id => navigate(`/suppliers/${id}`)} onSchedule={() => navigate('/schedule')} />}
      {path.startsWith('/plants/') && !selectedPlant && <NotFound label="Plant not found" onBack={() => navigate('/plants')} />}
      {path === '/suppliers' && <SupplierList items={visibleSuppliers} companyPlants={companyPlants} onSupplier={id => navigate(`/suppliers/${id}`)} />}
      {path.startsWith('/suppliers/') && selectedSupplier && <SupplierDetail supplier={selectedSupplier} onPlant={id => navigate(`/plants/${id}`)} />}
      {path.startsWith('/suppliers/') && !selectedSupplier && <NotFound label="Supplier not found" onBack={() => navigate('/suppliers')} />}
      {path === '/frequency' && <FrequencyPage plants={companyPlants} block={block} setBlock={changeBlock} onPlant={id => navigate(`/plants/${id}`)} onSupplier={id => navigate(`/suppliers/${id}`)} />}
      {path === '/meters' && <MeterPage plants={companyPlants} onPlant={id => navigate(`/plants/${id}`)} onSupplier={id => navigate(`/suppliers/${id}`)} />}
    </div>
  )
}

function estimateLoadSaving(plant: RpgPlant, currentHour: number, hours: number, targetHour: number, kw = plant.loads[0]?.kw ?? 0) {
  const current = averagePrice(plant, currentHour, hours)
  const target = averagePrice(plant, targetHour, hours)
  return Math.max(0, Math.round((current - target) * kw * hours))
}

function estimateLoadCarbon(plant: RpgPlant, currentHour: number, hours: number, targetHour: number, kw = plant.loads[0]?.kw ?? 0) {
  const current = averageCarbon(plant, currentHour, hours)
  const target = averageCarbon(plant, targetHour, hours)
  return Math.max(0, Math.round((current - target) * kw * hours / 1000))
}

function averagePrice(plant: RpgPlant, hour: number, hours: number) {
  const values = Array.from({ length: hours * 4 }, (_, index) => blockPrice(plant, (hour * 4 + index) % 96))
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageCarbon(plant: RpgPlant, hour: number, hours: number) {
  const values = Array.from({ length: hours * 4 }, (_, index) => blockCarbon(plant, (hour * 4 + index) % 96))
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function Overview({ plants: data, totalFlexible, totalSaving, totalCarbon, cheapestNow, block, approved, onApprove, onPlant, onSupplier, onSchedule }: {
  plants: RpgPlant[]; totalFlexible: number; totalSaving: number; totalCarbon: number; cheapestNow?: RpgPlant; block: number; approved: string[]; onApprove: (id: string) => void; onPlant: (id: string) => void; onSupplier: (id: string) => void; onSchedule: () => void
}) {
  const regional = regions.map(region => {
    const group = data.filter(plant => plant.region === region)
    const lead = group.map(plant => ({ plant, supplier: dispatchForPlant(plant, block)[0] })).filter(item => item.supplier).sort((a, b) => a.supplier.price - b.supplier.price)[0]
    return { region, plants: group, lead }
  }).filter(item => item.plants.length)
    const recommendations = data.flatMap(plant => plant.loads.map((load, index) => ({ plant, load, index, saving: estimateLoadSaving(plant, load.currentHour, load.hours, Math.max(6, load.allowedStart), load.kw) }))).sort((a, b) => b.saving - a.saving).slice(0, 5)
  const actualDemand = Array.from({ length: 96 }, (_, slot) => data.reduce((sum, plant) => sum + estimatedPlantDemand(plant, slot), 0))
  const plannedDemand = Array.from({ length: 96 }, (_, slot) => data.reduce((sum, plant) => sum + estimatedPlantDemand(plant, slot, true), 0))

  return <>
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi label="Flexible demand" value={`${totalFlexible.toFixed(1)} MW`} hint={`${data.length} plants in current scope`} icon={Zap} tone="teal" />
      <Kpi label="Estimated daily opportunity" value={money(totalSaving)} hint="Modeled shift vs assumed current slot" icon={ArrowDownRight} tone="green" />
      <Kpi label="Modeled CO₂ scenario" value={`${(totalCarbon / 1000).toFixed(2)} t`} hint="No meter-verified abatement" icon={Leaf} tone="blue" />
      <Kpi label="Lowest blended source now" value={cheapestNow ? `${cheapestNow.company} ${cheapestNow.name}` : '—'} hint={cheapestNow ? `₹${blockPrice(cheapestNow, block).toFixed(2)}/kWh · block ${block + 1}` : 'No plants in scope'} icon={Factory} tone="amber" />
    </section>

    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
      <Panel title="Group demand · 96 fifteen-minute blocks" subtitle="Illustrative fixed operating profile compared with the proposed shift plan." action={<Pill tone="warn">Mock meter profile</Pill>}>
        <LineChart series={[{ label: 'Current profile', color: '#c44b45', values: actualDemand, dashed: true }, { label: 'Proposed plan', color: '#0f8b8d', values: plannedDemand }]} min={0} max={Math.ceil(Math.max(...actualDemand, ...plannedDemand))} />
        <Legend items={[['#c44b45', 'Current profile (mock)'], ['#0f8b8d', 'Proposed schedule (mock)']]} />
      </Panel>
      <div className="rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 p-5 text-white">
        <div className="flex items-center gap-2 text-sm font-bold"><Leaf size={16} />Portfolio scenario</div>
        <p className="mt-2 text-xs leading-relaxed text-slate-200">Shifting modeled flexible loads toward lower-price windows gives an indicative opportunity of <b className="text-white">{money(totalSaving)}</b> and approximately <b className="text-white">{(totalCarbon / 1000).toFixed(2)} t CO₂</b> for the next operating day.</p>
        <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg bg-white/10 p-3"><b className="block text-lg">{data.reduce((sum, plant) => sum + plant.loads.length, 0)}</b><span className="text-[10px] text-slate-300">flexible loads</span></div><div className="rounded-lg bg-white/10 p-3"><b className="block text-lg">{data.length}</b><span className="text-[10px] text-slate-300">RPG sites</span></div></div>
        <p className="mt-3 text-[10px] text-slate-300">Demonstration data only. No meter-confirmed savings.</p>
      </div>
    </section>

    <section className="mt-5">
      <SectionHeader title="RPG plants" subtitle="Select any site to inspect supplier dispatch, frequency and its load plan." action={<Link to="/plants" className="text-xs font-bold text-teal-700">View all plants <ArrowRight size={13} className="ml-1 inline" /></Link>} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map(plant => {
          const source = dispatchForPlant(plant, block)[0]
          const frequency = plantFrequency(plant, block)
          const saved = estimateLoadSaving(plant, 18, 3, Math.max(6, plant.loads[0].allowedStart), plant.loads[0].kw)
          return <button key={plant.id} onClick={() => onPlant(plant.id)} className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-lg">
            <div className="flex items-start justify-between gap-2"><div><div className="font-extrabold text-slate-900">{plant.company} · {plant.name}</div><div className="mt-0.5 text-[11px] text-slate-500">{plant.location} · {plant.discom}</div></div><Pill tone={plant.archetype === 'C' ? 'teal' : 'neutral'}>Type {plant.archetype}</Pill></div>
            <div className="mt-3 grid grid-cols-3 gap-2"><Mini label="Now" value={`₹${blockPrice(plant, block).toFixed(2)}`} /><Mini label="Frequency" value={`${frequency.toFixed(2)} Hz`} /><Mini label="Opportunity" value={money(saved)} /></div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-500"><span>{plant.flexibleMw.toFixed(1)} MW flexible</span><span>{source?.supplier.name ?? 'No source'} lead supplier</span></div>
          </button>
        })}
      </div>
    </section>

    <section className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Cheapest source by region" subtitle={`Dispatch merit order · block ${block + 1} · ${blockLabel(block)} IST`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{regional.map(({ region, plants: group, lead }) => lead && <button key={region} onClick={() => onSupplier(lead.supplier.supplier.id)} className="rounded-lg bg-slate-50 p-3 text-left transition hover:bg-teal-50"><div className="flex items-center justify-between"><Pill tone="teal">{region}</Pill><span className="text-xs font-bold text-teal-800">₹{lead.supplier.price.toFixed(2)}/kWh</span></div><b className="mt-2 block text-xs text-slate-800">{lead.supplier.supplier.name}</b><span className="text-[10px] text-slate-500">Serves {group.length} visible RPG site{group.length === 1 ? '' : 's'}</span></button>)}</div>
      </Panel>
      <Panel title="Recommendations awaiting review" subtitle="Illustrative schedule suggestions. Approval updates this demo view only." action={<button onClick={onSchedule} className="text-xs font-bold text-teal-700">Open schedule <ArrowRight className="ml-1 inline" size={13} /></button>}>
        <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-xs"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="py-2">Plant / load</th><th>Move</th><th>Opportunity</th><th></th></tr></thead><tbody>{recommendations.map(({ plant, load, index, saving }) => { const id = `${plant.id}-${index}`; const start = Math.max(6, load.allowedStart); return <tr key={id} className="border-b border-slate-100"><td className="py-2 pr-2"><b className="block text-slate-800">{plant.company} {plant.name}</b><span className="text-[10px] text-slate-500">{load.name}</span></td><td className="pr-2">{hourLabel(load.currentHour)} → {hourLabel(start)}</td><td className="pr-2 font-bold text-emerald-700">{money(saving)}</td><td>{approved.includes(id) ? <Pill tone="good">Approved</Pill> : <button onClick={() => onApprove(id)} className="rounded-md bg-teal-700 px-2 py-1 text-[10px] font-bold text-white">Approve</button>}</td></tr> })}</tbody></table></div>
      </Panel>
    </section>
  </>
}

function PlantList({ plants: data, block, onPlant }: { plants: RpgPlant[]; block: number; onPlant: (id: string) => void }) {
  const ranked = [...data].sort((a, b) => blockPrice(a, block) - blockPrice(b, block))
  const rankById = new Map(ranked.map((plant, index) => [plant.id, index + 1]))

  return <>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Kpi label="RPG sites" value={String(data.length)} hint="Visible in the current company scope" icon={Factory} />
      <Kpi label="Flexible demand" value={`${data.reduce((sum, plant) => sum + plant.flexibleMw, 0).toFixed(1)} MW`} hint={`${data.reduce((sum, plant) => sum + plant.loads.length, 0)} registered flexible loads`} icon={Zap} tone="blue" />
      <Kpi label="Regions covered" value={String(new Set(data.map(plant => plant.region)).size)} hint="West, South, Central and North" icon={Radio} tone="green" />
      <Kpi label="Data posture" value="Illustrative" hint="Market, meter and source telemetry are demo profiles" icon={Activity} tone="amber" />
    </section>

    <section className="mt-4 rounded-xl border border-teal-100 bg-gradient-to-r from-white via-white to-teal-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">RPG plant register</h2>
          <p className="mt-1 text-xs text-slate-500">Compare each site’s indicative landed cost, frequency, flexible capacity and best one-hour price window.</p>
        </div>
        <Pill tone="warn">DEMO TELEMETRY · NOT LIVE METER DATA</Pill>
      </div>
    </section>

    {regions.map(region => {
      const group = data.filter(plant => plant.region === region)
      if (!group.length) return null
      const supplierIds = new Set(group.flatMap(plant => plant.supplierIds))
      const averageNow = group.reduce((sum, plant) => sum + blockPrice(plant, block), 0) / group.length
      return <section key={region} className="mt-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="mr-1 text-sm font-extrabold text-slate-900">{region} region</h3>
          <Pill>{group.length} plant{group.length === 1 ? '' : 's'}</Pill>
          <Pill tone="teal">{supplierIds.size} linked sources</Pill>
          <Pill tone="warn">Avg ₹{averageNow.toFixed(2)}/kWh</Pill>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {group.map(plant => <PlantCard key={plant.id} plant={plant} block={block} rank={rankById.get(plant.id) ?? data.length} onClick={() => onPlant(plant.id)} />)}
        </div>
      </section>
    })}
  </>
}

function PlantCard({ plant, block, rank, onClick }: { plant: RpgPlant; block: number; rank: number; onClick: () => void }) {
  const currentSources = dispatchForPlant(plant, block)
  const lead = currentSources[0]
  const frequency = plantFrequency(plant, block)
  const status = frequencyStatus(frequency)
  const bestBlock = bestHour(Array.from({ length: 96 }, (_, index) => blockPrice(plant, index)))
  const bestHourStart = bestBlock / 4
  const bestAverage = Array.from({ length: 4 }, (_, offset) => blockPrice(plant, (bestBlock + offset) % 96)).reduce((sum, price) => sum + price, 0) / 4
  const saving = plant.loads.reduce((sum, load) => sum + estimateLoadSaving(plant, load.currentHour, load.hours, Math.max(6, bestHourStart), load.kw), 0)
  const carbon = blockCarbon(plant, block)
  const sourceCount = plant.supplierIds.length
  const priceRank = rank <= 3

  return <button onClick={onClick} className="group flex min-h-[212px] flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 focus-visible:outline-offset-2">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-extrabold text-slate-900">{plant.company} · {plant.name}</span>
          {priceRank && <Pill tone="neutral">#{rank} lowest now</Pill>}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{plant.location} · {plant.discom}</p>
      </div>
      <Pill tone={plant.archetype === 'C' ? 'teal' : 'neutral'}>Type {plant.archetype}</Pill>
    </div>

    <div className="flex flex-wrap gap-1.5">
      <Pill tone={status.tone}>{frequency.toFixed(2)} Hz · {status.label}</Pill>
      <Pill>{plant.contractMva} MVA contract</Pill>
    </div>

    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      <Mini label="Landed now" value={`₹${blockPrice(plant, block).toFixed(2)}/kWh`} />
      <Mini label="Carbon model" value={`${Math.round(carbon)} g/kWh`} />
      <Mini label="Flexible" value={`${plant.flexibleMw.toFixed(1)} MW`} />
    </div>

    <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
      <Pill tone="teal">{sourceCount} sources</Pill>
      <Pill>1h low {blockLabel(bestBlock)}</Pill>
      <Pill tone="good">Indicative {money(saving)}</Pill>
    </div>
    <div className="flex items-center justify-between text-[10px] text-slate-400">
      <span>Lead: {lead?.supplier.name ?? 'No available source'} · window avg ₹{bestAverage.toFixed(2)}</span>
      <span className="font-bold text-teal-700 transition group-hover:translate-x-0.5">Details →</span>
    </div>
  </button>
}

function PlantBlockHeatmap({ plant, block, prices, onSelect }: { plant: RpgPlant; block: number; prices: number[]; onSelect: (block: number) => void }) {
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const heatColor = (price: number) => {
    const ratio = (price - minPrice) / (maxPrice - minPrice || 1)
    const stops = [
      { at: 0, color: [20, 156, 112] },
      { at: 0.5, color: [239, 190, 73] },
      { at: 1, color: [203, 83, 75] },
    ]
    const left = ratio < 0.5 ? stops[0] : stops[1]
    const right = ratio < 0.5 ? stops[1] : stops[2]
    const progress = (ratio - left.at) / (right.at - left.at)
    const color = left.color.map((channel, index) => Math.round(channel + (right.color[index] - channel) * progress))
    return `rgb(${color[0]} ${color[1]} ${color[2]})`
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0)
  const currentBlock = hour * 4 + Math.floor(minute / 15)

  return <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <SectionHeader title="96 time blocks · blended landed cost" subtitle="Select a quarter-hour to inspect supplier dispatch, frequency and indicative plant demand." />
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[640px] space-y-1.5">
        <div className="grid grid-cols-[38px_repeat(24,minmax(20px,1fr))] items-center gap-[2px]">
          <span />
          {Array.from({ length: 24 }, (_, hourIndex) => <span key={hourIndex} className="text-center text-[9px] font-semibold text-slate-400">{hourIndex % 3 === 0 ? String(hourIndex).padStart(2, '0') : ''}</span>)}
        </div>
        {[0, 1, 2, 3].map(quarter => <div key={quarter} className="grid grid-cols-[38px_repeat(24,minmax(20px,1fr))] items-center gap-[2px]">
          <span className="text-[9px] font-semibold text-slate-400">:{String(quarter * 15).padStart(2, '0')}</span>
          {Array.from({ length: 24 }, (_, hourIndex) => {
            const index = hourIndex * 4 + quarter
            const value = prices[index]
            return <button
              key={index}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`${plant.company} ${plant.name}, block ${index + 1}, ${blockLabel(index)} IST, ₹${value.toFixed(2)}/kWh`}
              title={`Block ${index + 1} · ${blockLabel(index)} · ₹${value.toFixed(2)}/kWh`}
              style={{ backgroundColor: heatColor(value) }}
              className={`relative h-6 rounded-[5px] border border-white/50 transition hover:brightness-95 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${index === currentBlock ? 'ring-2 ring-inset ring-slate-900' : ''} ${index === block ? 'z-[1] outline outline-2 outline-blue-700 outline-offset-1' : ''}`}
            />
          })}
        </div>)}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500">
      <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Lower cost</span>
      <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />Mid-range</span>
      <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500" />Higher cost</span>
      <span><i className="mr-1 inline-block h-2 w-2 rounded-sm ring-2 ring-slate-900" />Current block</span>
      <span><i className="mr-1 inline-block h-2 w-2 rounded-sm outline outline-2 outline-blue-700" />Selected block</span>
      <span className="font-semibold text-amber-700">Illustrative profile · no live meter feed</span>
    </div>
  </section>
}

function PlantDetail({ plant, block, setBlock, approved, onApprove, onSupplier, onSchedule }: { plant: RpgPlant; block: number; setBlock: (block: number) => void; approved: string[]; onApprove: (id: string) => void; onSupplier: (id: string) => void; onSchedule: () => void }) {
  const sources = dispatchForPlant(plant, block)
  const cheapestFrequencyQualified = sources.find(source => source.availableMw > 0.5 && source.frequencyRank < 2)?.supplier.id
  const frequency = plantFrequency(plant, block)
  const dailyCost = Array.from({ length: 96 }, (_, index) => blockPrice(plant, index))
  const demand = Array.from({ length: 96 }, (_, index) => estimatedPlantDemand(plant, index))
  const plan = Array.from({ length: 96 }, (_, index) => estimatedPlantDemand(plant, index, true))
  const currentBlock = currentIstBlock()
  const blockEnd = blockLabelEnd(block)
  const peakPrice = Math.max(...dailyCost)
  const importMwh = demand.slice(0, currentBlock + 1).reduce((sum, value) => sum + value * 0.25, 0)
  const maxDemand = Math.max(...demand.slice(0, currentBlock + 1))
  const meterPowerFactor = 0.95 + 0.03 * deterministic(plant.id.length + 3)
  const meterVoltage = 33 + (deterministic(plant.id.length + 9) - 0.5) * 0.6
  const blockGridFrequency = gridFrequency(block)
  const frequencySeries: Series[] = [
    { label: 'Grid frequency', color: '#0f1f38', values: Array.from({ length: 96 }, (_, index) => gridFrequency(index)), dashed: true },
    { label: `${plant.name} plant`, color: '#0f8b8d', values: Array.from({ length: 96 }, (_, index) => plantFrequency(plant, index)) },
  ]

  return <>
    <div className="flex flex-wrap gap-2">
      <Pill tone="teal">{plant.region} region</Pill>
      <Pill>{plant.location}</Pill>
      <Pill>{plant.discom}</Pill>
      <Pill>Contract {plant.contractMva} MVA</Pill>
      <Pill tone="warn">DEMO TELEMETRY</Pill>
    </div>
    <section className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-5">
      <Kpi label="Blended landed cost" value={`₹${blockPrice(plant, block).toFixed(2)}`} hint={`Lead: ${sources[0]?.supplier.name ?? '—'}`} icon={Zap} tone="amber" />
      <Kpi label="Cheapest 1-hour window" value={blockLabel(bestHour(dailyCost))} hint={`₹${Math.min(...dailyCost).toFixed(2)}/kWh average`} icon={Clock3} tone="teal" />
      <Kpi label="Plant frequency" value={`${frequency.toFixed(3)} Hz`} hint={`${Math.round((frequency - blockGridFrequency) * 1000)} mHz vs grid`} icon={Activity} tone="blue" />
      <Kpi label="Modeled shift value" value={money(plant.loads.reduce((sum, load) => sum + estimateLoadSaving(plant, load.currentHour, load.hours, Math.max(6, load.allowedStart), load.kw), 0))} hint={`${plant.loads.length} illustrative flexible loads`} icon={ArrowDownRight} tone="green" />
      <Kpi label="Meter profile" value={`${demand[block].toFixed(2)} MW`} hint="Illustrative, not live meter data" icon={Gauge} tone="amber" />
    </section>

    <PlantBlockHeatmap plant={plant} block={block} prices={dailyCost} onSelect={setBlock} />

    <section className="mt-4 rounded-xl border border-blue-200 bg-white p-4">
      <SectionHeader
        title={`Block ${block + 1} of 96 · ${blockLabel(block)}–${blockEnd}${block === currentBlock ? ' current' : ''}`}
        subtitle={`All sources that can supply ${plant.company} ${plant.name} in this window, with grid and plant frequency.`}
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Mini label="Grid frequency" value={`${blockGridFrequency.toFixed(3)} Hz`} />
        <Mini label="Plant frequency" value={`${frequency.toFixed(3)} Hz · ${Math.round((frequency - blockGridFrequency) * 1000)} mHz`} />
        <Mini label="Landed cost" value={`₹${blockPrice(plant, block).toFixed(2)}/kWh`} />
        <Mini label="Plant demand" value={`${demand[block].toFixed(2)} MW · ${money(demand[block] * 250)} / block`} />
        <Mini label="Versus peak" value={`−${Math.max(0, (1 - blockPrice(plant, block) / peakPrice) * 100).toFixed(0)}%`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-xs">
          <thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="py-2">#</th><th>Supplier plant</th><th>Type</th><th>Available MW</th><th>Dispatch MW</th><th>₹/kWh</th><th>gCO₂/kWh</th><th>Supplier Hz</th><th>Δ vs grid</th><th>Status</th></tr></thead>
          <tbody>
            {sources.map((source, index) => {
              const delta = Math.round((source.frequency - blockGridFrequency) * 1000)
              const status = frequencyStatus(source.frequency)
              return <tr key={source.supplier.id} className={`border-b border-slate-100 ${index === 0 ? 'bg-teal-50/70' : ''}`}>
                <td className="py-2 font-bold">{index + 1}</td>
                <td><button onClick={() => onSupplier(source.supplier.id)} className="font-bold text-teal-800 hover:underline">{source.supplier.name}</button></td>
                <td><Pill>{source.supplier.type}</Pill></td>
                <td>{source.availableMw.toFixed(1)}</td>
                <td>{source.dispatchedMw.toFixed(1)}</td>
                <td className="font-semibold">₹{source.price.toFixed(2)}</td>
                <td>{Math.round(source.emissions)}</td>
                <td>{source.frequency.toFixed(3)}</td>
                <td>{delta > 0 ? '+' : ''}{delta} mHz</td>
                <td>{source.availableMw <= 0.5
                  ? <Pill>Not generating</Pill>
                  : source.frequencyRank === 2
                    ? <Pill tone="bad">Out of band</Pill>
                    : <Pill tone={status.tone}>{source.supplier.id === cheapestFrequencyQualified ? 'Cheapest available · frequency ranked' : status.label}</Pill>}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Supplier price by block (₹/kWh)" subtitle="Gaps mean that source is not generating. Blue marker shows the selected block.">
        <Chart series={sourcesSeries(plant).concat([{ label: 'Blended landed cost', color: '#0f1f38', values: dailyCost, dashed: true }])} min={2} max={11} selected={block} />
        <Legend items={[...sources.map(source => [supplierColor(source.supplier.type), source.supplier.name] as [string, string]), ['#0f1f38', 'Blended landed cost']]} />
      </Panel>
      <Panel title="Grid vs plant frequency" subtitle="Green band is the permitted 49.95–50.05 Hz operating range.">
        <Chart series={frequencySeries} min={49.9} max={50.1} selected={block} band={[49.95, 50.05]} suffix=" Hz" />
        <Legend items={[["#0f1f38", 'Grid frequency'], ['#0f8b8d', `${plant.name} plant`], ['#d9f0e1', 'Permitted band']]} />
      </Panel>
    </section>

    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.85fr]">
      <Panel title="Plant meter — demand per block (MW)" subtitle={`${plant.id.toUpperCase()} · fixed schedule versus modeled GridSync plan`}>
        <Chart series={[{ label: 'Fixed schedule', color: '#c0392b', values: demand, dashed: true }, { label: 'GridSync plan', color: '#0f8b8d', values: plan }]} min={0} max={Math.ceil(Math.max(...demand, ...plan))} selected={block} />
        <Legend items={[["#c0392b", 'Fixed schedule (mock)'], ['#0f8b8d', 'GridSync plan (mock)']]} />
      </Panel>
      <Panel title="Meter register" subtitle={`Mock readings · ${blockLabel(currentBlock)} IST`}>
        <div className="divide-y divide-slate-100">
          { [
            ['Meter ID', `MTR-${plant.id.toUpperCase()}-HT01`],
            ['Selected block demand', `${demand[block].toFixed(2)} MW`],
            ['Import today', `${importMwh.toFixed(1)} MWh`],
            ['Max demand', `${(maxDemand / meterPowerFactor).toFixed(1)} / ${plant.contractMva} MVA`],
            ['Power factor', meterPowerFactor.toFixed(3)],
            ['Voltage', `${meterVoltage.toFixed(1)} kV`],
            ['Plant frequency', `${plantFrequency(plant, currentBlock).toFixed(3)} Hz`],
          ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="text-slate-500">{label}</span><b className="text-right text-slate-800">{value}</b></div>) }
        </div>
        <p className="mt-2 text-[10px] text-amber-700">Illustrative demo telemetry. Replace with interval meter readings before operational or financial verification.</p>
      </Panel>
    </section>

    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <SectionHeader title="Flexible loads and recommended windows" subtitle="Suggestions preserve configured duration and allowed start windows; approval remains a human decision." action={<button onClick={onSchedule} className="text-xs font-bold text-teal-700">Open Schedule →</button>} />
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="py-2">Load</th><th>Draw</th><th>Now</th><th>Move to</th><th>₹/kWh</th><th>Indicative saving</th><th></th></tr></thead><tbody>{plant.loads.map((load, index) => { const id = `${plant.id}-${index}`; const suggested = Math.max(6, load.allowedStart); const saving = estimateLoadSaving(plant, load.currentHour, load.hours, suggested, load.kw); return <tr key={id} className="border-b border-slate-100"><td className="py-2 font-semibold">{load.name}</td><td>{load.kw.toLocaleString()} kW</td><td>{hourLabel(load.currentHour)} · {load.hours}h</td><td><Pill tone="teal">{hourLabel(suggested)}–{hourLabel(suggested + load.hours)}</Pill></td><td>₹{averagePrice(plant, load.currentHour, load.hours).toFixed(2)} → ₹{averagePrice(plant, suggested, load.hours).toFixed(2)}</td><td className="font-bold text-emerald-700">{money(saving)}</td><td>{approved.includes(id) ? <Pill tone="good">Approved</Pill> : <button onClick={() => onApprove(id)} className="rounded-md bg-teal-700 px-2 py-1 font-bold text-white">Approve</button>}</td></tr> })}</tbody></table></div>
    </section>
  </>
}

function currentIstBlock() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0)
  return hour * 4 + Math.floor(minute / 15)
}

function blockLabelEnd(block: number) {
  const end = block + 1
  if (end >= 96) return '24:00'
  return blockLabel(end)
}

function sourcesSeries(plant: RpgPlant): Series[] {
  const palette = ['#0f8b8d', '#d99a00', '#286ba1', '#b44545', '#815bb0', '#439b64']
  return plant.supplierIds.map((id, index) => { const supplier = suppliers.find(item => item.id === id)!; return { label: supplier.name, color: palette[index % palette.length], values: Array.from({ length: 96 }, (_, block) => supplierAvailability(supplier, block) > 0.5 ? supplierPrice(supplier, block) : 0) } })
}

function supplierColor(type: SupplierType) {
  return ({ Thermal: '#b44545', Solar: '#d99a00', Wind: '#0f8b8d', Hydro: '#286ba1', Market: '#815bb0' })[type]
}

function NotFound({ label, onBack }: { label: string; onBack: () => void }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-8 text-center"><h2 className="font-bold text-slate-900">{label}</h2><button onClick={onBack} className="mt-3 text-xs font-bold text-teal-700">Back to list</button></section>
}

function SupplierList({ items, companyPlants, onSupplier }: { items: SupplierPlant[]; companyPlants: RpgPlant[]; onSupplier: (id: string) => void }) {
  const regionalGroups = regions.map(region => ({ region, suppliers: items.filter(supplier => supplier.region === region) })).filter(group => group.suppliers.length)
  return <>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Kpi label="Linked sources" value={String(items.length)} hint="Visible in current company scope" icon={Radio} /><Kpi label="Connected capacity" value={`${items.reduce((sum, source) => sum + source.capacityMw, 0).toLocaleString()} MW`} hint="Registered source capacity" icon={Zap} tone="blue" /><Kpi label="RPG plants served" value={String(companyPlants.length)} hint="Current company filter" icon={Factory} tone="green" /><Kpi label="Data posture" value="Demo" hint="Supplier curves are illustrative" icon={Activity} tone="amber" /></section>
    {regionalGroups.map(group => <section key={group.region} className="mt-5"><SectionHeader title={`${group.region} region`} subtitle={`${group.suppliers.length} supplier sources`} /><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[820px] text-xs"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="px-4 py-3">Supplier plant</th><th>Type</th><th>Capacity</th><th>Available now</th><th>Price now</th><th>Carbon</th><th>RPG plants</th></tr></thead><tbody>{group.suppliers.map(source => <tr key={source.id} onClick={() => onSupplier(source.id)} className="cursor-pointer border-b border-slate-100 hover:bg-teal-50"><td className="px-4 py-3 font-bold text-teal-800">{source.name}</td><td><Pill>{source.type}</Pill></td><td>{source.capacityMw} MW</td><td>{supplierAvailability(source, 58).toFixed(1)} MW</td><td>₹{supplierPrice(source, 58).toFixed(2)}/kWh</td><td>{Math.round(supplierEmissions(source, 58))} g/kWh</td><td>{source.servedPlants.filter(id => companyPlants.some(plant => plant.id === id)).length}</td></tr>)}</tbody></table></div></section>)}
    {items.filter(source => source.region === 'All').map(source => <div key={source.id} className="mt-5"><SupplierCard supplier={source} onClick={() => onSupplier(source.id)} /></div>)}
  </>
}

function SupplierCard({ supplier, onClick }: { supplier: SupplierPlant; onClick: () => void }) {
  return <button onClick={onClick} className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-teal-400 hover:shadow-sm"><div className="flex items-start justify-between gap-3"><div><b className="text-sm text-slate-900">{supplier.name}</b><p className="mt-1 text-xs text-slate-500">{supplier.type} · all regions</p></div><Pill tone="teal">Market source</Pill></div><div className="mt-3 grid grid-cols-3 gap-2"><Mini label="Price now" value={`₹${supplierPrice(supplier, 58).toFixed(2)}/kWh`} /><Mini label="Carbon" value={`${Math.round(supplierEmissions(supplier, 58))} g/kWh`} /><Mini label="96-block avg" value={`₹${averageSupplierPrice(supplier).toFixed(2)}`} /></div></button>
}

function SupplierDetail({ supplier, onPlant }: { supplier: SupplierPlant; onPlant: (id: string) => void }) {
  const connected = plants.filter(plant => supplier.servedPlants.includes(plant.id))
  const prices = Array.from({ length: 96 }, (_, index) => supplierAvailability(supplier, index) > 0.5 ? supplierPrice(supplier, index) : 0)
  const emissions = Array.from({ length: 96 }, (_, index) => supplierEmissions(supplier, index))
  const output = Array.from({ length: 96 }, (_, index) => supplierAvailability(supplier, index))
  return <>
    <div className="flex flex-wrap gap-2"><Pill tone="teal">{supplier.type}</Pill><Pill>{supplier.region === 'All' ? 'All regions' : `${supplier.region} region`}</Pill><Pill>{supplier.capacityMw} MW capacity</Pill><Pill tone="warn">Demo profile</Pill></div>
    <section className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4"><Kpi label="Available now" value={`${supplierAvailability(supplier, 58).toFixed(1)} MW`} hint="Illustrative source profile" icon={Zap} /><Kpi label="Price now" value={`₹${supplierPrice(supplier, 58).toFixed(2)}`} hint="Modeled ₹/kWh" icon={Gauge} tone="amber" /><Kpi label="Carbon factor" value={`${Math.round(supplierEmissions(supplier, 58))} g`} hint="Modeled gCO₂/kWh" icon={Leaf} tone="green" /><Kpi label="Type" value={supplier.type} hint="Registered source" icon={Factory} tone="blue" /></section>
    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2"><Panel title="Supplier price by block" subtitle="Illustrative price curve, 96 quarter-hour blocks."><Chart series={[{ label: supplier.name, color: supplierColor(supplier.type), values: prices }]} min={0} max={Math.max(...prices, 1)} /><Legend items={[[supplierColor(supplier.type), supplier.name]]} /></Panel><Panel title="Availability and modeled emissions" subtitle="Forecast availability and source-type emissions proxy."><Chart series={[{ label: 'Available MW', color: '#0f8b8d', values: output }, { label: 'gCO₂/kWh', color: '#2f9e5f', values: emissions }]} min={0} max={Math.max(...emissions, ...output, 1)} /><Legend items={[["#0f8b8d", 'Available MW (modeled)'], ['#2f9e5f', 'Carbon factor (modeled)']]} /></Panel></section>
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><SectionHeader title="RPG plants served" subtitle="Open a connected plant to inspect its 96-block profile." /><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{connected.map(plant => <button key={plant.id} onClick={() => onPlant(plant.id)} className="rounded-lg border border-slate-200 p-3 text-left hover:border-teal-400"><b className="text-xs">{plant.company} · {plant.name}</b><p className="mt-1 text-[10px] text-slate-500">{plant.location} · {plant.flexibleMw} MW flexible</p></button>)}</div></section>
  </>
}

function FrequencyPage({ plants: data, block, setBlock, onPlant, onSupplier }: { plants: RpgPlant[]; block: number; setBlock: (block: number) => void; onPlant: (id: string) => void; onSupplier: (id: string) => void }) {
  const grid = gridFrequency(block)
  const entries = [
    ...data.map(plant => ({ id: plant.id, name: `${plant.company} ${plant.name}`, type: 'RPG plant', value: plantFrequency(plant, block), open: () => onPlant(plant.id) })),
    ...suppliers.filter(source => source.region === 'All' || data.some(plant => plant.region === source.region)).filter(source => supplierAvailability(source, block) > 0.5).map(source => ({ id: source.id, name: source.name, type: source.type, value: grid + (deterministic(source.capacityMw * 57 + block) - 0.5) * 0.03, open: () => onSupplier(source.id) })),
  ].sort((a, b) => a.value - b.value)
  const series = Array.from({ length: 96 }, (_, index) => index)
  return <>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Kpi label="Grid frequency" value={`${grid.toFixed(3)} Hz`} hint={`${blockLabel(block)} IST · mock telemetry`} icon={Activity} tone="blue" /><Kpi label="Entities in view" value={String(entries.length)} hint="Plants and available sources" icon={Radio} /><Kpi label="Outside ±0.05 Hz" value={String(entries.filter(entry => Math.abs(entry.value - 50) > 0.05).length)} hint="Synthetic data requires validation" icon={AlertTriangle} tone="amber" /><Kpi label="Selected block" value={`${block + 1} / 96`} hint={`${blockLabel(block)} IST`} icon={Clock3} tone="teal" /></section>
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><SectionHeader title={`Grid vs every plant · block ${block + 1} · ${blockLabel(block)} IST`} subtitle="Drag the selector to inspect 96 blocks; readings are illustrative demo data." /><input aria-label="Frequency time block" type="range" min="0" max="95" value={block} onChange={event => setBlock(Number(event.target.value))} className="w-full accent-teal-700" /><div className="mt-2 flex justify-between text-[10px] text-slate-400"><span>00:00</span><span>{blockLabel(block)} · {block + 1}/96</span><span>23:45</span></div></section>
    <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]"><Panel title="Frequency across the day" subtitle="Green band indicates the 49.95–50.05 Hz operating range."><Chart series={[{ label: 'Grid', color: '#0f1f38', values: series.map(index => gridFrequency(index)), dashed: true }, { label: data[0] ? `${data[0].company} ${data[0].name}` : 'RPG plant', color: '#0f8b8d', values: series.map(index => data[0] ? plantFrequency(data[0], index) : 50) }]} min={49.88} max={50.12} selected={block} band={[49.95, 50.05]} suffix=" Hz" /><Legend items={[["#0f1f38", 'Grid reference (mock)'], ['#0f8b8d', 'Selected plant (mock)'], ['#d9f0e1', 'Operating band']]} /></Panel><Panel title="Lowest frequency readings" subtitle="Sorted at the selected block; select a row to open its detail."><div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[460px] text-xs"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="py-2">Entity</th><th>Type</th><th>Hz</th><th>Δ mHz</th><th>Status</th></tr></thead><tbody>{entries.map(entry => { const delta = Math.round((entry.value - grid) * 1000); const status = frequencyStatus(entry.value); return <tr key={entry.id} onClick={entry.open} className="cursor-pointer border-b border-slate-100 hover:bg-teal-50"><td className="py-2 font-semibold">{entry.name}</td><td><Pill>{entry.type}</Pill></td><td>{entry.value.toFixed(3)}</td><td>{delta > 0 ? '+' : ''}{delta}</td><td><Pill tone={status.tone}>{status.label}</Pill></td></tr> })}</tbody></table></div></Panel></section>
  </>
}

function MeterPage({ plants: data, onPlant, onSupplier }: { plants: RpgPlant[]; onPlant: (id: string) => void; onSupplier: (id: string) => void }) {
  const incomerMwh = data.reduce((sum, plant) => sum + Array.from({ length: 59 }, (_, block) => estimatedPlantDemand(plant, block) * 0.25).reduce((total, value) => total + value, 0), 0)
  return <>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Kpi label="RPG incomer meters" value={String(data.length)} hint="Illustrative record per registered site" icon={Gauge} /><Kpi label="Import today" value={`${incomerMwh.toFixed(1)} MWh`} hint="Mock cumulative interval profile" icon={Zap} tone="blue" /><Kpi label="Supplier injection meters" value={String(suppliers.length)} hint="Synthetic scheduled/actual series" icon={Radio} tone="teal" /><Kpi label="Data status" value="DEMO" hint="Not connected to plant meters" icon={AlertTriangle} tone="amber" /></section>
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><SectionHeader title="RPG plant incomers" subtitle="Illustrative 15-minute demand, import, power factor, voltage and frequency. Select a row for plant detail." /><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-xs"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="py-2">Plant</th><th>Meter ID</th><th>Now MW</th><th>Import today</th><th>Max demand</th><th>PF</th><th>Voltage</th><th>Frequency</th><th>Status</th></tr></thead><tbody>{data.map((plant, index) => { const demand = estimatedPlantDemand(plant, 58); const mwh = Array.from({ length: 59 }, (_, item) => estimatedPlantDemand(plant, item) * 0.25).reduce((sum, value) => sum + value, 0); const pf = 0.95 + 0.03 * deterministic(index + 3); const voltage = 33 + (deterministic(index + 9) - 0.5) * 0.6; return <tr key={plant.id} onClick={() => onPlant(plant.id)} className="cursor-pointer border-b border-slate-100 hover:bg-teal-50"><td className="py-2 font-bold text-teal-800">{plant.company} {plant.name}</td><td>MTR-{plant.id.toUpperCase()}-HT01</td><td>{demand.toFixed(2)}</td><td>{mwh.toFixed(1)} MWh</td><td>{(demand / pf).toFixed(1)} / {plant.contractMva} MVA</td><td>{pf.toFixed(3)}</td><td>{voltage.toFixed(1)} kV</td><td>{plantFrequency(plant, 58).toFixed(3)} Hz</td><td><Pill tone="warn">Mock</Pill></td></tr> })}</tbody></table></div></section>
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><SectionHeader title="Supplier injections" subtitle="Compare synthetic output and schedule deviation; this is not a live settlement feed." /><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-xs"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-400"><th className="py-2">Supplier plant</th><th>Region</th><th>Scheduled</th><th>Actual</th><th>Deviation</th><th>Status</th></tr></thead><tbody>{suppliers.map(source => { const scheduled = Array.from({ length: 59 }, (_, index) => supplierAvailability(source, index) * 0.25).reduce((sum, value) => sum + value, 0); const actual = scheduled * (1 + (deterministic(source.capacityMw) - 0.5) * 0.08); const deviation = scheduled ? (actual - scheduled) / scheduled * 100 : 0; return <tr key={source.id} onClick={() => onSupplier(source.id)} className="cursor-pointer border-b border-slate-100 hover:bg-teal-50"><td className="py-2 font-semibold text-teal-800">{source.name}</td><td>{source.region}</td><td>{scheduled.toFixed(1)} MWh</td><td>{actual.toFixed(1)} MWh</td><td>{deviation > 0 ? '+' : ''}{deviation.toFixed(1)}%</td><td><Pill tone="warn">Demo estimate</Pill></td></tr> })}</tbody></table></div></section>
  </>
}

function LineChart({ series, min, max }: { series: Series[]; min: number; max: number }) {
  return <Chart series={series} min={min} max={max} height={190} />
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><SectionHeader title={title} subtitle={subtitle} action={action} />{children}</section>
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-extrabold text-slate-900">{title}</h2><p className="mt-1 text-[11px] text-slate-500">{subtitle}</p></div>{action}</header>
}

function Kpi({ label, value, hint, icon: Icon, tone = 'teal' }: { label: string; value: string; hint: string; icon: typeof Zap; tone?: 'teal' | 'green' | 'amber' | 'blue' }) {
  const colors = { teal: 'bg-teal-50 text-teal-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700' }
  return <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 after:absolute after:-right-5 after:-top-5 after:h-20 after:w-20 after:rounded-full after:bg-teal-50"><div className={`relative z-[1] mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${colors[tone]}`}><Icon size={16} /></div><div className="relative z-[1] text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="relative z-[1] mt-1 truncate text-xl font-extrabold text-slate-900">{value}</div><div className="relative z-[1] mt-1 text-[10px] text-slate-500">{hint}</div></div>
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-md bg-slate-50 px-2 py-1.5"><span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</span><b className="mt-0.5 block truncate text-[11px] text-slate-800">{value}</b></div>
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-500">{items.map(([color, label]) => <span key={label} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />{label}</span>)}</div>
}

function bestHour(values: number[]) {
  let best = 0
  let bestAverage = Infinity
  for (let start = 0; start <= values.length - 4; start += 1) {
    const average = values.slice(start, start + 4).reduce((sum, value) => sum + value, 0) / 4
    if (average < bestAverage) { bestAverage = average; best = start }
  }
  return best
}

function averageSupplierPrice(source: SupplierPlant) {
  const values = Array.from({ length: 96 }, (_, block) => supplierAvailability(source, block) > 0.5 ? supplierPrice(source, block) : 0).filter(value => value > 0)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}
