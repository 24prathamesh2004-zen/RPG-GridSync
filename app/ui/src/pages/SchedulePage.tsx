import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, Clock, Zap, Leaf, CalendarClock, ListChecks } from 'lucide-react'
import {
  listPlants,
  listLoads,
  getDailyScheduleStatus,
  generateRecommendations,
  listRecommendations,
  approveRecommendation,
  rejectRecommendation,
  completeRecommendation,
  type Plant,
  type Recommendation,
  type DailyScheduleStatus,
} from '../services/api'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  overridden: 'bg-gray-100 text-gray-500',
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'text-green-600',
  medium: 'text-amber-600',
  low: 'text-red-600',
}

export default function SchedulePage() {
  const [plants, setPlants] = useState<Plant[]>([])
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null)
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [activeLoadCount, setActiveLoadCount] = useState(0)
  const [scheduleStatus, setScheduleStatus] = useState<DailyScheduleStatus | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'completed'>('all')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    listPlants().then(r => {
      setPlants(r.data)
      if (r.data.length > 0) setSelectedPlant(r.data[0])
    }).catch(() => setError('Failed to load plants'))
    getDailyScheduleStatus().then(r => setScheduleStatus(r.data)).catch(() => setScheduleStatus(null))
  }, [])

  useEffect(() => {
    if (selectedPlant) loadRecs()
  }, [selectedPlant])

  const loadRecs = async () => {
    if (!selectedPlant) return
    setLoading(true)
    try {
      const [r, loads] = await Promise.all([
        listRecommendations(selectedPlant.id, undefined, istDate()),
        listLoads(selectedPlant.id),
      ])
      setRecs(r.data)
      setActiveLoadCount(loads.data.length)
    } catch {
      setError('Failed to load recommendations')
    } finally {
      setLoading(false)
    }
  }

  const generate = async () => {
    if (!selectedPlant) return
    setGenerating(true)
    setError('')
    setNotice('')
    try {
      const result = await generateRecommendations(selectedPlant.id)
      if (result.data.recommendations.length === 0 && result.data.skipped_existing > 0) {
        setNotice('Today’s recommendations are already up to date.')
      }
      await loadRecs()
    } catch {
      setError('Could not update today’s schedule. Check that this plant has active flex loads.')
    } finally {
      setGenerating(false)
    }
  }

  const approve = async (id: number) => {
    await approveRecommendation(id)
    setRecs(prev => prev.map(r => r.id === id ? { ...r, status: 'approved' } : r))
  }

  const reject = async (id: number) => {
    const reason = prompt('Reason for rejection (optional):') || ''
    await rejectRecommendation(id, reason)
    setRecs(prev => prev.map(r => r.id === id ? { ...r, status: 'rejected' } : r))
  }

  const complete = async (id: number) => {
    await completeRecommendation(id)
    setRecs(prev => prev.map(r => r.id === id ? { ...r, status: 'completed' } : r))
  }

  const todayRecs = recs.filter(rec => statusFilter === 'all' || rec.status === statusFilter)
  const pendingCount = recs.filter(rec => rec.status === 'pending').length
  const approvedCount = recs.filter(rec => rec.status === 'approved').length
  const scheduledLoadCount = new Set(recs.map(rec => rec.load_id)).size
  const generatedAt = recs.reduce<string | null>((latest, rec) => {
    if (!rec.created_at) return latest
    return !latest || rec.created_at > latest ? rec.created_at : latest
  }, null)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Schedule</h2>
          <p className="text-gray-500 mt-1 text-sm">Today’s plant-level operating queue · IST</p>
        </div>
        <button
          onClick={generate}
          disabled={!selectedPlant || generating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-zen text-white text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={15} className={generating ? 'animate-spin' : ''} />
          {generating ? 'Updating…' : 'Generate missing loads'}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-gray-200 bg-white">
        <div className="px-4 py-3 border-r border-gray-100">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Loads scheduled</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-gray-900">{scheduledLoadCount}</span>
            <span className="text-xs text-gray-400">/ {activeLoadCount} active</span>
          </div>
        </div>
        <div className="px-4 py-3 border-r border-gray-100">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Needs review</div>
          <div className="mt-1 flex items-center gap-2">
            <ListChecks size={16} className="text-amber-600" />
            <span className="text-xl font-bold text-gray-900">{pendingCount}</span>
            <span className="text-xs text-gray-400">pending approval</span>
          </div>
        </div>
        <div className="px-4 py-3 border-r border-gray-100">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Ready to run</div>
          <div className="mt-1 flex items-center gap-2">
            <CheckCircle size={15} className="text-blue-600" />
            <span className="text-xl font-bold text-gray-900">{approvedCount}</span>
            <span className="text-xs text-gray-400">approved</span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Daily refresh</div>
          <div className="mt-1 flex items-center gap-2">
            <CalendarClock size={16} className="text-zen-600" />
            <span className="text-sm font-bold text-gray-900">
              {scheduleStatus?.enabled ? `${scheduleStatus.time} ${scheduleStatus.timezone}` : 'Disabled'}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">
            {generatedAt ? `Updated ${new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for today’s run'}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="border-l-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      )}

      {/* Plant selector */}
      <div className="flex flex-wrap gap-2">
        {plants.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedPlant(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              selectedPlant?.id === p.id
                ? 'bg-zen-600 text-white border-zen-600'
                : 'bg-white text-gray-700 border-gray-200 hover:border-zen-300'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-gray-200">
        <div className="flex gap-4" role="tablist" aria-label="Recommendation status">
          {(['all', 'pending', 'approved', 'completed'] as const).map(status => (
            <button
              key={status}
              role="tab"
              aria-selected={statusFilter === status}
              onClick={() => setStatusFilter(status)}
              className={`pb-2 text-xs font-semibold capitalize border-b-2 transition-colors ${statusFilter === status ? 'border-zen-600 text-zen-700' : 'border-transparent text-gray-400 hover:text-gray-700'}`}
            >
              {status === 'all' ? `All (${recs.length})` : `${status} (${recs.filter(rec => rec.status === status).length})`}
            </button>
          ))}
        </div>
        <span className="pb-2 text-[10px] text-gray-400">{selectedPlant?.name} · {istDate()}</span>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
      ) : recs.length === 0 ? (
        <div className="card p-8 text-center">
          <Clock size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No recommendations for today.</p>
          <p className="text-gray-400 text-xs mt-1">
            Daily generation runs automatically when enabled. You can also generate missing loads now.
          </p>
        </div>
      ) : todayRecs.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400">No {statusFilter} recommendations in today’s queue.</div>
      ) : (
        <div className="space-y-3">
          {todayRecs.map(rec => (
            <div key={rec.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">{rec.load_name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[rec.status] || 'bg-gray-100 text-gray-500'}`}>
                      {rec.status}
                    </span>
                    <span className={`text-xs font-medium ${CONFIDENCE_STYLES[rec.confidence]}`}>
                      {rec.confidence} confidence
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {rec.recommended_start.slice(11, 16)} → {rec.recommended_end.slice(11, 16)} IST
                    {' · '}{rec.recommended_date}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 text-green-700 font-semibold">
                    <Zap size={14} />
                    ₹{rec.estimated_saving_rs.toFixed(0)}
                  </div>
                  <div className="flex items-center gap-1 text-emerald-600 text-xs mt-0.5">
                    <Leaf size={12} />
                    {rec.estimated_carbon_saving_kg.toFixed(1)} kgCO₂
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-500 leading-relaxed">{rec.reason}</p>

              {rec.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => approve(rec.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                  >
                    <CheckCircle size={13} /> Approve
                  </button>
                  <button
                    onClick={() => reject(rec.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                </div>
              )}
              {rec.status === 'approved' && (
                <button
                  onClick={() => complete(rec.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
                >
                  <CheckCircle size={13} /> Mark completed
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function istDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
