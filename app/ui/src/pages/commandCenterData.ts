export type Region = 'West' | 'South' | 'Central' | 'North'
export type SupplierType = 'Thermal' | 'Solar' | 'Wind' | 'Hydro' | 'Market'

export interface SupplierPlant {
  id: string
  name: string
  type: SupplierType
  region: Region | 'All'
  capacityMw: number
  basePrice: number
  emissions: number
  servedPlants: string[]
}

export interface FlexibleLoad {
  name: string
  kw: number
  hours: number
  currentHour: number
  allowedStart: number
  allowedEnd: number
  approved: boolean
}

export interface RpgPlant {
  id: string
  company: 'CEAT' | 'KEC'
  name: string
  region: Region
  location: string
  discom: string
  archetype: 'A' | 'B' | 'C'
  flexibleMw: number
  contractMva: number
  supplierIds: string[]
  loads: FlexibleLoad[]
}

export interface DispatchSource {
  supplier: SupplierPlant
  availableMw: number
  dispatchedMw: number
  price: number
  emissions: number
  frequency: number
  frequencyRank: number
}

const plantRows: RpgPlant[] = [
  { id: 'ceat-bhandup', company: 'CEAT', name: 'Bhandup', region: 'West', location: 'Mumbai, MH', discom: 'MSEDCL', archetype: 'C', flexibleMw: 6.2, contractMva: 14, supplierIds: ['tata-trombay', 'adani-kutch', 'suzlon-dhule', 'ss-hydro', 'iex-dam'], loads: [
    { name: 'Tyre curing press pre-heat', kw: 2100, hours: 3, currentHour: 18, allowedStart: 6, allowedEnd: 23, approved: false },
    { name: 'Banbury mixer cooling loop', kw: 1240, hours: 4, currentHour: 17, allowedStart: 0, allowedEnd: 22, approved: true },
    { name: 'Chilled water pre-cool', kw: 990, hours: 3, currentHour: 19, allowedStart: 8, allowedEnd: 22, approved: false },
    { name: 'Effluent and batch pumping', kw: 620, hours: 4, currentHour: 18, allowedStart: 0, allowedEnd: 23, approved: false },
  ] },
  { id: 'ceat-halol', company: 'CEAT', name: 'Halol', region: 'West', location: 'Panchmahal, GJ', discom: 'PGVCL', archetype: 'C', flexibleMw: 14.8, contractMva: 32, supplierIds: ['tata-trombay', 'adani-kutch', 'suzlon-dhule', 'ss-hydro', 'iex-dam'], loads: [
    { name: 'Tyre curing press bank A', kw: 5200, hours: 4, currentHour: 18, allowedStart: 6, allowedEnd: 23, approved: true },
    { name: 'Banbury mixer line 2', kw: 3100, hours: 3, currentHour: 16, allowedStart: 7, allowedEnd: 22, approved: false },
    { name: 'Cooling tower pumps', kw: 1800, hours: 5, currentHour: 19, allowedStart: 0, allowedEnd: 23, approved: false },
    { name: 'Compressed air pre-charge', kw: 1450, hours: 3, currentHour: 17, allowedStart: 6, allowedEnd: 21, approved: false },
  ] },
  { id: 'ceat-kanchipuram', company: 'CEAT', name: 'Kanchipuram', region: 'South', location: 'Kanchipuram, TN', discom: 'TNPDCL', archetype: 'C', flexibleMw: 9.4, contractMva: 21, supplierIds: ['ntpl-tuticorin', 'pavagada-solar', 'muppandal-wind', 'sharavathi-hydro', 'iex-dam'], loads: [
    { name: 'Curing cycle set', kw: 3500, hours: 4, currentHour: 18, allowedStart: 5, allowedEnd: 23, approved: false },
    { name: 'Bead wire drawing', kw: 2400, hours: 5, currentHour: 16, allowedStart: 8, allowedEnd: 22, approved: false },
    { name: 'Chilled water system', kw: 1300, hours: 3, currentHour: 15, allowedStart: 0, allowedEnd: 23, approved: true },
  ] },
  { id: 'ceat-nagpur', company: 'CEAT', name: 'Nagpur', region: 'Central', location: 'Nagpur, MH', discom: 'MSEDCL', archetype: 'A', flexibleMw: 8.1, contractMva: 18, supplierIds: ['khargone-tps', 'omkareshwar-solar', 'indira-sagar', 'iex-dam'], loads: [
    { name: 'Tyre curing press bank', kw: 3000, hours: 4, currentHour: 18, allowedStart: 6, allowedEnd: 23, approved: false },
    { name: 'Mixer batch cycle', kw: 2200, hours: 3, currentHour: 17, allowedStart: 6, allowedEnd: 22, approved: false },
    { name: 'Compressor load', kw: 1100, hours: 5, currentHour: 16, allowedStart: 0, allowedEnd: 23, approved: false },
  ] },
  { id: 'ceat-nashik', company: 'CEAT', name: 'Nashik', region: 'West', location: 'Nashik, MH', discom: 'MSEDCL', archetype: 'C', flexibleMw: 5.6, contractMva: 12, supplierIds: ['tata-trombay', 'adani-kutch', 'suzlon-dhule', 'ss-hydro', 'iex-dam'], loads: [
    { name: 'Specialty curing batches', kw: 1800, hours: 3, currentHour: 18, allowedStart: 6, allowedEnd: 23, approved: false },
    { name: 'Calender line warm-up', kw: 1450, hours: 4, currentHour: 16, allowedStart: 7, allowedEnd: 21, approved: false },
    { name: 'Cooling and pumping', kw: 900, hours: 3, currentHour: 17, allowedStart: 0, allowedEnd: 23, approved: true },
  ] },
  { id: 'kec-jaipur', company: 'KEC', name: 'Jaipur', region: 'North', location: 'Jaipur, RJ', discom: 'JVVNL', archetype: 'B', flexibleMw: 7.3, contractMva: 16, supplierIds: ['suratgarh-tps', 'bhadla-solar', 'jaisalmer-wind', 'iex-dam'], loads: [
    { name: 'Galvanizing kettle heat-up', kw: 2800, hours: 4, currentHour: 17, allowedStart: 0, allowedEnd: 22, approved: false },
    { name: 'Paint-shop curing oven', kw: 1600, hours: 3, currentHour: 18, allowedStart: 8, allowedEnd: 22, approved: false },
    { name: 'Fleet charging', kw: 750, hours: 5, currentHour: 20, allowedStart: 0, allowedEnd: 23, approved: true },
  ] },
  { id: 'kec-mysore', company: 'KEC', name: 'Mysore', region: 'South', location: 'Mysuru, KA', discom: 'CESC Mysore', archetype: 'B', flexibleMw: 4.9, contractMva: 11, supplierIds: ['ntpl-tuticorin', 'pavagada-solar', 'muppandal-wind', 'sharavathi-hydro', 'iex-dam'], loads: [
    { name: 'Tower hardware annealing', kw: 1700, hours: 3, currentHour: 18, allowedStart: 6, allowedEnd: 22, approved: false },
    { name: 'Galvanizing batch', kw: 1400, hours: 4, currentHour: 16, allowedStart: 0, allowedEnd: 21, approved: false },
    { name: 'Forklift charging', kw: 550, hours: 5, currentHour: 19, allowedStart: 0, allowedEnd: 23, approved: true },
  ] },
  { id: 'kec-nagpur', company: 'KEC', name: 'Nagpur', region: 'Central', location: 'Nagpur, MH', discom: 'MSEDCL', archetype: 'B', flexibleMw: 6.7, contractMva: 15, supplierIds: ['khargone-tps', 'omkareshwar-solar', 'indira-sagar', 'iex-dam'], loads: [
    { name: 'Galvanizing line heat-up', kw: 2400, hours: 4, currentHour: 18, allowedStart: 0, allowedEnd: 22, approved: false },
    { name: 'Annealing furnace batch', kw: 1850, hours: 3, currentHour: 17, allowedStart: 6, allowedEnd: 23, approved: false },
    { name: 'Compressor pre-charge', kw: 900, hours: 2, currentHour: 16, allowedStart: 0, allowedEnd: 22, approved: true },
  ] },
  { id: 'kec-vadodara', company: 'KEC', name: 'Vadodara', region: 'West', location: 'Vadodara, GJ', discom: 'MGVCL', archetype: 'B', flexibleMw: 8.8, contractMva: 19, supplierIds: ['tata-trombay', 'adani-kutch', 'suzlon-dhule', 'ss-hydro', 'iex-dam'], loads: [
    { name: 'Tower galvanizing kettle', kw: 3400, hours: 4, currentHour: 18, allowedStart: 0, allowedEnd: 22, approved: false },
    { name: 'Annealing furnace', kw: 2300, hours: 3, currentHour: 16, allowedStart: 6, allowedEnd: 22, approved: false },
    { name: 'Fleet and forklift charging', kw: 700, hours: 5, currentHour: 20, allowedStart: 0, allowedEnd: 23, approved: true },
  ] },
]

export const suppliers: SupplierPlant[] = [
  { id: 'tata-trombay', name: 'Tata Power Trombay', type: 'Thermal', region: 'West', capacityMw: 150, basePrice: 7.9, emissions: 830, servedPlants: ['ceat-bhandup', 'ceat-halol', 'ceat-nashik', 'kec-vadodara'] },
  { id: 'adani-kutch', name: 'Adani Green Kutch Solar', type: 'Solar', region: 'West', capacityMw: 60, basePrice: 3.6, emissions: 18, servedPlants: ['ceat-bhandup', 'ceat-halol', 'ceat-nashik', 'kec-vadodara'] },
  { id: 'suzlon-dhule', name: 'Suzlon Dhule Wind', type: 'Wind', region: 'West', capacityMw: 45, basePrice: 4.4, emissions: 15, servedPlants: ['ceat-bhandup', 'ceat-halol', 'ceat-nashik', 'kec-vadodara'] },
  { id: 'ss-hydro', name: 'Sardar Sarovar Hydro', type: 'Hydro', region: 'West', capacityMw: 40, basePrice: 5.6, emissions: 24, servedPlants: ['ceat-bhandup', 'ceat-halol', 'ceat-nashik', 'kec-vadodara'] },
  { id: 'ntpl-tuticorin', name: 'NTPL Tuticorin', type: 'Thermal', region: 'South', capacityMw: 120, basePrice: 7.7, emissions: 830, servedPlants: ['ceat-kanchipuram', 'kec-mysore'] },
  { id: 'pavagada-solar', name: 'Pavagada Solar Park', type: 'Solar', region: 'South', capacityMw: 70, basePrice: 3.5, emissions: 18, servedPlants: ['ceat-kanchipuram', 'kec-mysore'] },
  { id: 'muppandal-wind', name: 'Muppandal Wind', type: 'Wind', region: 'South', capacityMw: 50, basePrice: 4.3, emissions: 15, servedPlants: ['ceat-kanchipuram', 'kec-mysore'] },
  { id: 'sharavathi-hydro', name: 'Sharavathi Hydro', type: 'Hydro', region: 'South', capacityMw: 45, basePrice: 5.4, emissions: 24, servedPlants: ['ceat-kanchipuram', 'kec-mysore'] },
  { id: 'suratgarh-tps', name: 'Suratgarh TPS', type: 'Thermal', region: 'North', capacityMw: 130, basePrice: 7.5, emissions: 830, servedPlants: ['kec-jaipur'] },
  { id: 'bhadla-solar', name: 'Bhadla Solar Park', type: 'Solar', region: 'North', capacityMw: 80, basePrice: 3.4, emissions: 18, servedPlants: ['kec-jaipur'] },
  { id: 'jaisalmer-wind', name: 'Jaisalmer Wind', type: 'Wind', region: 'North', capacityMw: 55, basePrice: 4.2, emissions: 15, servedPlants: ['kec-jaipur'] },
  { id: 'khargone-tps', name: 'Khargone TPS', type: 'Thermal', region: 'Central', capacityMw: 110, basePrice: 7.8, emissions: 830, servedPlants: ['ceat-nagpur', 'kec-nagpur'] },
  { id: 'omkareshwar-solar', name: 'Omkareshwar Floating Solar', type: 'Solar', region: 'Central', capacityMw: 50, basePrice: 3.7, emissions: 18, servedPlants: ['ceat-nagpur', 'kec-nagpur'] },
  { id: 'indira-sagar', name: 'Indira Sagar Hydro', type: 'Hydro', region: 'Central', capacityMw: 40, basePrice: 5.5, emissions: 24, servedPlants: ['ceat-nagpur', 'kec-nagpur'] },
  { id: 'iex-dam', name: 'IEX Day-Ahead Market', type: 'Market', region: 'All', capacityMw: 200, basePrice: 6.4, emissions: 710, servedPlants: plantRows.map(plant => plant.id) },
]

export const plants = plantRows
export const regions: Region[] = ['West', 'South', 'Central', 'North']

const plantTariffProfiles: Record<string, { base: number; peak: number; solarRebate: number; nightRebate: number; phase: number }> = {
  'ceat-bhandup': { base: 0.12, peak: 0.34, solarRebate: 0.17, nightRebate: 0.09, phase: -0.7 },
  'ceat-halol': { base: 0.08, peak: 0.48, solarRebate: 0.22, nightRebate: 0.04, phase: 0.8 },
  'ceat-kanchipuram': { base: 0.2, peak: 0.36, solarRebate: 0.19, nightRebate: 0.07, phase: 1.2 },
  'ceat-nagpur': { base: 0.16, peak: 0.4, solarRebate: 0.1, nightRebate: 0.06, phase: 2.1 },
  'ceat-nashik': { base: 0.05, peak: 0.3, solarRebate: 0.16, nightRebate: 0.12, phase: -1.6 },
  'kec-jaipur': { base: 0.11, peak: 0.45, solarRebate: 0.21, nightRebate: 0.03, phase: 0.3 },
  'kec-mysore': { base: 0.24, peak: 0.33, solarRebate: 0.14, nightRebate: 0.08, phase: -1.1 },
  'kec-nagpur': { base: 0.02, peak: 0.43, solarRebate: 0.11, nightRebate: 0.1, phase: 1.7 },
  'kec-vadodara': { base: 0.18, peak: 0.46, solarRebate: 0.2, nightRebate: 0.05, phase: -0.3 },
}

export function deterministic(seed: number) {
  const value = Math.sin(seed * 12.9898 + 7.1) * 43758.5453
  return value - Math.floor(value)
}

export function hourLabel(hour: number) {
  return `${String(hour % 24).padStart(2, '0')}:00`
}

export function blockLabel(block: number) {
  return `${String(Math.floor(block / 4) % 24).padStart(2, '0')}:${String((block % 4) * 15).padStart(2, '0')}`
}

export function plantFrequency(plant: RpgPlant, block: number) {
  const base = { 'ceat-bhandup': 49.97, 'ceat-halol': 50.01, 'ceat-kanchipuram': 49.95, 'ceat-nagpur': 50.02, 'ceat-nashik': 49.99, 'kec-jaipur': 49.93, 'kec-mysore': 50, 'kec-nagpur': 50.03, 'kec-vadodara': 49.98 }[plant.id] ?? 50
  return base + 0.035 * Math.sin(block / 7) + 0.02 * Math.sin(block / 2.3) + (deterministic(plant.id.length * 71 + block) - 0.5) * 0.02
}

export function gridFrequency(block: number) {
  return 50 + 0.035 * Math.sin(block / 7) + 0.02 * Math.sin(block / 2.3) + (deterministic(block) - 0.5) * 0.02
}

export function frequencyBandRank(deviationHz: number) {
  const deviationMhz = Math.abs(deviationHz) * 1000
  return deviationMhz <= 30 ? 0 : deviationMhz <= 50 ? 1 : 2
}

export function supplierAvailability(supplier: SupplierPlant, block: number) {
  const hour = block / 4
  if (supplier.type === 'Solar') return Math.max(0, Math.sin(Math.PI * (hour - 6) / 12)) * supplier.capacityMw
  if (supplier.type === 'Wind') return supplier.capacityMw * (0.55 + 0.4 * Math.cos((hour - 3) / 24 * Math.PI * 2)) * (0.85 + 0.3 * deterministic(supplier.capacityMw + block))
  if (supplier.type === 'Market') return supplier.capacityMw
  return supplier.capacityMw * (0.9 + 0.1 * deterministic(supplier.capacityMw * 3 + block))
}

export function supplierPrice(supplier: SupplierPlant, block: number) {
  const hour = Math.floor(block / 4)
  const todFactor = [0.82, 0.8, 0.8, 0.82, 0.85, 0.92, 1.02, 1.1, 1.05, 0.92, 0.82, 0.78, 0.76, 0.76, 0.78, 0.84, 0.98, 1.25, 1.4, 1.38, 1.3, 1.15, 1, 0.9][hour]
  return supplier.basePrice * (0.35 + 0.65 * todFactor) * (1 + (deterministic(supplier.capacityMw * 131 + block) - 0.5) * (supplier.type === 'Market' ? 0.12 : 0.03))
}

export function supplierEmissions(supplier: SupplierPlant, block: number) {
  const hourShape = [1.05, 1.07, 1.08, 1.08, 1.06, 1, 0.92, 0.85, 0.76, 0.68, 0.62, 0.58, 0.57, 0.6, 0.66, 0.76, 0.9, 1.08, 1.18, 1.2, 1.16, 1.12, 1.09, 1.06][Math.floor(block / 4)]
  return supplier.type === 'Thermal' ? supplier.emissions : supplier.emissions * hourShape
}

export function dispatchForPlant(plant: RpgPlant, block: number): DispatchSource[] {
  let remaining = plant.flexibleMw * 3.5
  const gridHz = gridFrequency(block)
  const plantHz = plantFrequency(plant, block)
  return plant.supplierIds
    .map(id => suppliers.find(supplier => supplier.id === id))
    .filter((supplier): supplier is SupplierPlant => Boolean(supplier))
    .map(supplier => ({
      supplier,
      availableMw: supplierAvailability(supplier, block),
      dispatchedMw: 0,
      price: supplierPrice(supplier, block),
      emissions: supplierEmissions(supplier, block),
      frequency: gridHz + (deterministic(supplier.capacityMw * 57 + block) - 0.5) * 0.03,
      frequencyRank: 0,
    }))
    .map(source => ({
      ...source,
      frequencyRank: Math.max(
        frequencyBandRank(gridHz - 50),
        frequencyBandRank(plantHz - gridHz),
        frequencyBandRank(source.frequency - gridHz),
      ),
    }))
    .sort((a, b) => {
      const aAvailable = a.availableMw > 0.5 ? 0 : 1
      const bAvailable = b.availableMw > 0.5 ? 0 : 1
      return aAvailable - bAvailable || a.frequencyRank - b.frequencyRank || a.price - b.price
    })
    .map(source => {
      source.dispatchedMw = Math.min(source.availableMw, remaining)
      remaining -= source.dispatchedMw
      return source
    })
}

export function blockPrice(plant: RpgPlant, block: number) {
  const sources = dispatchForPlant(plant, block)
  const dispatched = sources.reduce((sum, source) => sum + source.dispatchedMw, 0)
  const wholesale = dispatched
    ? sources.reduce((sum, source) => sum + source.dispatchedMw * source.price, 0) / dispatched
    : plant.region === 'West' ? 4.1 : 4.3
  const profile = plantTariffProfiles[plant.id] ?? { base: 0.12, peak: 0.38, solarRebate: 0.14, nightRebate: 0.06, phase: 0 }
  const hour = block / 4
  const solarHour = Math.max(0, Math.sin(Math.PI * (hour - 6 - profile.phase * 0.22) / 12))
  const wrappedDistance = (value: number, center: number) => Math.abs(((value - center + 36) % 24) - 12)
  const eveningDistance = wrappedDistance(hour, 19 + profile.phase)
  const peakHour = Math.exp(-(eveningDistance ** 2) / 5.5)
  const nightDistance = wrappedDistance(hour, 2.5 + profile.phase * 0.3)
  const nightHour = Math.exp(-(nightDistance ** 2) / 13)
  const quarterHourVariation = (deterministic(plant.id.length * 503 + block * 17) - 0.5) * 0.12
  const smoothBlockVariation = 0.035 * Math.sin((block + profile.phase * 4) * Math.PI / 8) + quarterHourVariation
  return Math.max(0.5, wholesale + profile.base + profile.peak * peakHour - profile.solarRebate * solarHour - profile.nightRebate * nightHour + smoothBlockVariation)
}

export function blockCarbon(plant: RpgPlant, block: number) {
  const sources = dispatchForPlant(plant, block)
  const dispatched = sources.reduce((sum, source) => sum + source.dispatchedMw, 0)
  if (!dispatched) return 710
  return sources.reduce((sum, source) => sum + source.dispatchedMw * source.emissions, 0) / dispatched
}

export function estimatedPlantDemand(plant: RpgPlant, block: number, planned = false) {
  const hour = block / 4
  const base = plant.flexibleMw * 2.9 * (0.88 + 0.12 * Math.sin((block - 20) / 96 * Math.PI * 2)) + (deterministic(plant.id.length * 200 + block) - 0.5) * 0.25
  const shifted = plant.loads.reduce((sum, load) => {
    const start = planned ? Math.max(load.allowedStart, 12) : load.currentHour
    return sum + (hour >= start && hour < start + load.hours ? load.kw / 1000 : 0)
  }, 0)
  return Math.max(0, base + shifted)
}
