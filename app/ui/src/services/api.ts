import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 60_000,
})

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Plant {
  id: number
  name: string
  company: string
  state: string
  archetype: 'A' | 'B' | 'C'
  utility: string
  power_sources: string[]
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

// ── API calls ─────────────────────────────────────────────────────────────────

// Plants
export const listPlants = () => api.get<Plant[]>('/plants/')
export const listLoads = (plantId: number) => api.get<FlexLoad[]>(`/plants/${plantId}/loads`)

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

export default api
