import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 60_000,
})

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Company {
  id: number
  name: string
  short_name: string
  sector: string
}

export interface Plant {
  id: number
  name: string
  company: string
  state: string
  archetype: 'A' | 'B' | 'C'
  utility: string
  power_sources: string[]
}

export interface Signal {
  block_start_ist: string
  price_rs_per_kwh: number
  price_source?: string
  price_status?: 'fresh' | 'estimated' | 'late' | 'missing' | string
  carbon_kg_per_kwh: number
  captive_availability: number
  window_score: number
  tod_slot: string
}

export interface SignalSummary {
  avg_price_rs_per_kwh: number
  min_price_rs_per_kwh: number
  max_price_rs_per_kwh: number
  avg_carbon_kg_per_kwh: number
  best_window_start: string
  best_window_score: number
  peak_blocks: number
  solar_rebate_blocks: number
  night_rebate_blocks: number
  price_range_rs_per_kwh: number
}

export interface Recommendation {
  id: number
  load_id: number
  load_name: string
  recommended_date: string
  recommended_start: string
  recommended_end: string
  reason: string
  estimated_saving_rs: number
  estimated_carbon_saving_kg: number
  confidence: 'high' | 'medium' | 'low'
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'overridden'
  created_at: string | null
}

export interface FlexLoad {
  id: number
  name: string
  power_kw: number
  run_hours: number
}

export interface DailyScheduleStatus {
  enabled: boolean
  time: string
  timezone: string
}

export interface AdvisorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ImpactOverview {
  total_avoided_cost_rs: number
  total_avoided_co2_kg: number
  total_avoided_co2_tonnes: number
  total_runs: number
  active_plants: number
  potential_saving_rs: number
  potential_carbon_kg: number
  total_recommendations: number
  pending_recommendations: number
  approved_recommendations: number
  completed_recommendations: number
  rejected_recommendations: number
}

export interface CompanyImpact {
  company_id: number
  company_name: string
  avoided_cost_rs: number
  avoided_co2_kg: number
  runs: number
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const checkHealth = () => api.get<{ status: string }>('/health')

// Plants
export const listPlants = () => api.get<Plant[]>('/plants/')
export const listCompanies = () => api.get<Company[]>('/plants/companies')
export const getPlant = (id: number) => api.get(`/plants/${id}`)
export const listLoads = (plantId: number) => api.get<FlexLoad[]>(`/plants/${plantId}/loads`)
export const addFlexLoad = (plantId: number, data: object) =>
  api.post(`/plants/${plantId}/loads`, data)

// Signals
export const getTodaySignals = (plantId: number, date?: string) =>
  api.get<{ plant_id: number; plant_name: string; date: string; signals: Signal[]; summary: SignalSummary }>(
    `/signals/${plantId}/today`,
    { params: date ? { for_date: date } : {} }
  )

export const getBestWindows = (plantId: number, loadId: number) =>
  api.get(`/signals/${plantId}/windows`, { params: { load_id: loadId } })

// Recommendations
export const generateRecommendations = (plantId: number) =>
  api.post(`/recommendations/generate/${plantId}`)

export const listRecommendations = (plantId: number, status?: string, forDate?: string) =>
  api.get<Recommendation[]>(`/recommendations/${plantId}`, {
    params: { ...(status ? { status } : {}), ...(forDate ? { for_date: forDate } : {}) },
  })

export const getDailyScheduleStatus = () =>
  api.get<DailyScheduleStatus>('/recommendations/schedule/status')

export const approveRecommendation = (recId: number) =>
  api.post(`/recommendations/${recId}/approve`)

export const rejectRecommendation = (recId: number, reason = '') =>
  api.post(`/recommendations/${recId}/reject`, null, { params: { reason } })

export const completeRecommendation = (recId: number) =>
  api.post(`/recommendations/${recId}/complete`)

// Advisor
export const askAdvisor = (
  question: string,
  plantId?: number,
  history: AdvisorMessage[] = [],
  sessionId?: string,
) => api.post<{ session_id: string; answer: string }>('/advisor/ask', {
    question,
    plant_id: plantId ?? null,
    history: history.slice(-10),
    session_id: sessionId,
  })

// Impact
export const getImpactOverview = () => api.get<ImpactOverview>('/impact/overview')
export const getImpactByPlant = () => api.get('/impact/by-plant')
export const getImpactByCompany = () => api.get<CompanyImpact[]>('/impact/by-company')
export const getValuePerKw = (plantId: number, runHours = 4) =>
  api.get(`/impact/value-per-kw`, { params: { plant_id: plantId, run_hours: runHours } })

export default api
