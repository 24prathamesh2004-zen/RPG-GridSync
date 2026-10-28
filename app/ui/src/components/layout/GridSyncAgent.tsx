import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, AlertCircle, BotMessageSquare, Check, ChevronDown, ChevronUp, LoaderCircle, MessageSquare, Plus, Send, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { listPlants } from '../../services/api'
import { plants as commandPlants, suppliers as commandSuppliers } from '../../pages/commandCenterData'

type Role = 'user' | 'assistant'
type ToolFlow = { tool: string; arguments: Record<string, unknown>; result: Record<string, unknown> }
type AgentMessage = { role: Role; content: string; flow?: ToolFlow[]; confirmed?: string }
type Mode = 'advisory' | 'automated'
type PendingPreview = { previewId: string; summary: string }

const SUGGESTIONS = [
  'Which operating windows look best today?',
  'Show the latest meter readings',
  'What schedules are awaiting review?',
]

const routeLabels: Record<string, string> = {
  '/': 'Overview', '/plants': 'RPG Plants', '/suppliers': 'Supplier Plants',
  '/frequency': 'Frequency', '/meters': 'Meter Readings', '/schedule': 'Schedule',
}

function getSessionId() {
  const stored = localStorage.getItem('gridsync-agent-session')
  if (stored) return stored
  const created = crypto.randomUUID()
  localStorage.setItem('gridsync-agent-session', created)
  return created
}

function viewForPath(path: string) {
  if (path.startsWith('/plants/')) return 'plant'
  if (path.startsWith('/suppliers/')) return 'supplier'
  return routeLabels[path] ? path === '/' ? 'overview' : path.slice(1) : 'overview'
}

function messageText(tool: string, result: Record<string, unknown>) {
  if (typeof result.error === 'string') return result.error
  if (tool === 'get_blocks' && Array.isArray(result.blocks)) return `${result.blocks.length} quarter-hour signals returned.`
  if (tool === 'get_best_window' && Array.isArray(result.windows)) return `${result.windows.length} candidate windows calculated.`
  if (tool === 'get_meter' || tool === 'get_supplier_meter') return `Meter status: ${String(result.status ?? 'unknown')}.`
  if (tool === 'propose_schedule_change' || tool === 'approve_schedule') return 'Schedule preview ready for confirmation.'
  if (tool === 'navigate') return `Navigation option: ${String(result.view ?? 'view')}.`
  if (Array.isArray(result)) return `${result.length} record${result.length === 1 ? '' : 's'} returned.`
  return 'Tool result received.'
}

function targetPath(flow: ToolFlow, databasePlants: Array<{ id: number; name: string }>) {
  const view = String(flow.result.view ?? flow.arguments.view ?? '')
  const id = String(flow.result.id ?? flow.arguments.id ?? '')
  if (view === 'overview') return '/'
  if (view === 'plants') return '/plants'
  if (view === 'suppliers') return '/suppliers'
  if (view === 'frequency') return '/frequency'
  if (view === 'meters') return '/meters'
  if (view === 'schedule') return '/schedule'
  if (view === 'plant') {
    const staticMatch = commandPlants.find(plant => plant.id === id)
    const databaseMatch = databasePlants.find(plant => String(plant.id) === id)
    const normalizedName = databaseMatch?.name.replace(/^(CEAT|KEC)\s+/i, '').toLowerCase()
    const source = staticMatch ?? commandPlants.find(plant => plant.name.toLowerCase() === normalizedName)
    return source ? `/plants/${source.id}` : '/plants'
  }
  if (view === 'supplier') return commandSuppliers.some(supplier => supplier.id === id) ? `/suppliers/${id}` : '/suppliers'
  return '/'
}

export default function GridSyncAgent() {
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>(() => localStorage.getItem('gridsync-agent-mode') === 'automated' ? 'automated' : 'advisory')
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [failedQuestion, setFailedQuestion] = useState('')
  const [sessionId, setSessionId] = useState(getSessionId)
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null)
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null)
  const [databasePlants, setDatabasePlants] = useState<Array<{ id: number; name: string }>>([])
  const launcherRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const plantId = location.pathname.match(/^\/plants\/([^/]+)/)?.[1] ?? null
  const blockParam = new URLSearchParams(location.search).get('block')
  const block = blockParam && /^\d+$/.test(blockParam) ? Math.min(95, Number(blockParam)) : 58

  useEffect(() => {
    listPlants().then(response => setDatabasePlants(response.data.map(plant => ({ id: plant.id, name: plant.name }))))
      .catch(() => setDatabasePlants([]))
  }, [])

  useEffect(() => {
    const syncMode = () => setMode(localStorage.getItem('gridsync-agent-mode') === 'automated' ? 'automated' : 'advisory')
    window.addEventListener('gridsync-mode-change', syncMode)
    return () => window.removeEventListener('gridsync-mode-change', syncMode)
  }, [])

  useEffect(() => {
    void fetch('/api/v1/agent/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, mode }),
    })
  }, [mode, sessionId])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, error])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        window.setTimeout(() => launcherRef.current?.focus(), 0)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const closeAndRestoreFocus = () => {
    setOpen(false)
    window.setTimeout(() => launcherRef.current?.focus(), 0)
  }

  const updateLastAssistant = (update: (message: AgentMessage) => AgentMessage) => {
    setMessages(current => {
      const next = [...current]
      const last = next.length - 1
      if (last >= 0 && next[last].role === 'assistant') next[last] = update(next[last])
      return next
    })
  }

  const send = async (text = input, retry = false) => {
    const question = text.trim()
    if (!question || busy) return
    const prior = retry ? messages.slice(0, -2) : messages
    const history = prior.filter(message => message.content.trim()).slice(-20).map(({ role, content }) => ({ role, content }))
    if (!retry) setMessages(current => [...current, { role: 'user', content: question }, { role: 'assistant', content: '', flow: [] }])
    else setMessages(current => [...current.slice(0, -1), { role: 'assistant', content: '', flow: [] }])
    setInput('')
    setError('')
    setFailedQuestion('')
    setPendingPreview(null)
    setBusy(true)

    try {
      const response = await fetch('/api/v1/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          question,
          session_id: sessionId,
          history,
          context: { view: viewForPath(location.pathname), plant_id: plantId, block, mode },
        }),
      })
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}))
        throw new Error(typeof body.detail === 'string' ? body.detail : 'Agent request failed. Please retry.')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamError = ''
      let receivedDone = false
      const handleEvent = (raw: string) => {
        const lines = raw.split('\n')
        const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
        const dataLine = lines.find(line => line.startsWith('data:'))?.slice(5).trim()
        if (!eventName || !dataLine) return
        const data = JSON.parse(dataLine) as Record<string, unknown>
        if (eventName === 'token' && typeof data.text === 'string') {
          updateLastAssistant(message => ({ ...message, content: message.content + data.text }))
        }
        if (eventName === 'flow') {
          const flow = data as unknown as ToolFlow
          updateLastAssistant(message => ({ ...message, flow: [...(message.flow ?? []), flow] }))
          if ((flow.tool === 'propose_schedule_change' || flow.tool === 'approve_schedule') && typeof flow.result.preview_id === 'string') {
            setPendingPreview({
              previewId: flow.result.preview_id,
              summary: `${String((flow.result.preview as Record<string, unknown>)?.plant_name ?? 'Plant')} · ${String((flow.result.preview as Record<string, unknown>)?.load_name ?? 'Load')} · ${String((flow.result.preview as Record<string, unknown>)?.start ?? '')}`,
            })
          }
        }
        if (eventName === 'error') streamError = String(data.message ?? 'Agent request failed. Please retry.')
        if (eventName === 'done') receivedDone = true
      }
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        events.forEach(handleEvent)
        if (done) break
      }
      if (streamError) throw new Error(streamError)
      if (!receivedDone) throw new Error('The Agent response ended before completion. Retry the question.')
      updateLastAssistant(message => message.content ? message : ({ ...message, content: 'I could not form an answer from the available tool results. Please try a narrower question.' }))
      setFailedQuestion('')
    } catch (requestError: unknown) {
      const message = requestError instanceof Error ? requestError.message : 'GridSync Agent could not respond. Check the connection and retry.'
      setError(message)
      setFailedQuestion(question)
    } finally {
      setBusy(false)
    }
  }

  const confirmPreview = async (confirmed: boolean) => {
    if (!pendingPreview) return
    try {
      const response = await fetch('/api/v1/agent/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview_id: pendingPreview.previewId, session_id: sessionId, confirmed, mode }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Confirmation failed.')
      updateLastAssistant(message => ({ ...message, confirmed: confirmed ? `${String(data.status)} (#${data.recommendation_id}). No equipment was operated.` : 'Preview cancelled.' }))
      setPendingPreview(null)
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Confirmation failed.')
    }
  }

  const startNewThread = () => {
    const nextSession = crypto.randomUUID()
    localStorage.setItem('gridsync-agent-session', nextSession)
    setSessionId(nextSession)
    setMessages([])
    setInput('')
    setError('')
    setPendingPreview(null)
  }

  const setActionMode = (value: Mode) => {
    localStorage.setItem('gridsync-agent-mode', value)
    setMode(value)
    window.dispatchEvent(new Event('gridsync-mode-change'))
  }

  const currentPlant = commandPlants.find(plant => plant.id === plantId)
  const contextLabel = currentPlant ? `${currentPlant.company} ${currentPlant.name}` : routeLabels[location.pathname] ?? 'Command Center'

  return <>
    {open && <>
      <button aria-label="Close GridSync Agent" className="fixed inset-0 z-40 bg-slate-950/20 md:bg-transparent" onClick={closeAndRestoreFocus} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gridsync-agent-title" onKeyDown={event => {
        if (event.key !== 'Tab') return
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, select')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }} className="fixed inset-x-0 bottom-0 z-50 flex h-[86dvh] max-h-[760px] min-h-[440px] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl md:inset-auto md:bottom-24 md:right-6 md:h-[min(680px,calc(100vh-130px))] md:w-[430px] md:rounded-xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600"><BotMessageSquare size={19} /></span>
            <div className="min-w-0"><h2 id="gridsync-agent-title" className="text-sm font-bold">GridSync Agent</h2><p className="truncate text-[11px] text-slate-300">{contextLabel} · {mode === 'advisory' ? 'Advisory mode' : 'Automated mode'}</p></div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" title="Start a new conversation" aria-label="Start a new conversation" disabled={!messages.length || busy} onClick={startNewThread} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 disabled:opacity-40"><Plus size={17} /></button>
            <button type="button" title="Close GridSync Agent" aria-label="Close GridSync Agent" onClick={closeAndRestoreFocus} className="flex h-9 w-9 items-center justify-center rounded-md text-slate-300 hover:bg-white/10"><X size={18} /></button>
          </div>
        </header>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          <span className="flex min-w-0 items-center gap-1.5 truncate"><Activity size={13} className="shrink-0 text-teal-700" /> {contextLabel}{plantId ? ` · Block ${block + 1}` : ''}</span>
          <label className="ml-2 flex shrink-0 items-center gap-1.5 font-semibold text-slate-700">Mode
            <select aria-label="Agent operating mode" value={mode} onChange={event => setActionMode(event.target.value as Mode)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]">
              <option value="advisory">Advisory</option><option value="automated">Automated</option>
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.length === 0 && <div className="py-4">
            <div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-800"><MessageSquare size={18} /></span><div><h3 className="text-sm font-bold text-slate-900">Ask about GridSync</h3><p className="mt-1 text-xs leading-5 text-slate-500">Answers use registered plant data and computed signals. Missing sources are identified rather than guessed.</p></div></div>
            <div className="space-y-2">{(plantId ? [`What are the best windows for ${currentPlant?.name ?? 'this plant'}?`, 'Compare this plant’s 96-block prices and carbon', 'Show schedules awaiting review'] : SUGGESTIONS).map(question => <button key={question} type="button" disabled={busy} onClick={() => void send(question)} className="block w-full rounded-md border border-slate-200 px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:border-teal-500 hover:bg-teal-50/50">{question}</button>)}</div>
          </div>}

          {messages.map((message, index) => <article key={`${index}-${message.role}`} className={`min-w-0 ${message.role === 'user' ? 'ml-8' : 'mr-2'}`}>
            <div className={`mb-1 text-[10px] font-bold uppercase text-slate-400 ${message.role === 'user' ? 'text-right' : ''}`}>{message.role === 'user' ? 'You' : 'GridSync Agent'}</div>
            {message.role === 'user' ? <div className="rounded-lg bg-slate-900 px-3 py-2.5 text-sm leading-5 text-white">{message.content}</div> : <div className="min-w-0 text-sm leading-6 text-slate-800">
              {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : busy ? <span className="inline-flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin" /> Working through the available data…</span> : null}
              {message.flow?.length ? <div className="mt-3 space-y-1.5">{message.flow.map((flow, flowIndex) => {
                const key = `${index}-${flowIndex}`
                const isExpanded = expandedFlow === key
                const isNavigation = flow.tool === 'navigate' && flow.result.action === 'navigate'
                const isProposal = (flow.tool === 'propose_schedule_change' || flow.tool === 'approve_schedule') && Boolean(flow.result.preview_id)
                return <div key={key} className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  <button type="button" onClick={() => setExpandedFlow(isExpanded ? null : key)} className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[11px] font-semibold text-slate-700"><span className="truncate">{flow.tool.replace(/_/g, ' ')} <span className="font-normal text-slate-500">· {messageText(flow.tool, flow.result)}</span></span>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                  {isExpanded && <pre className="max-h-44 overflow-auto border-t border-slate-200 bg-white px-2.5 py-2 text-[10px] leading-4 text-slate-600">{JSON.stringify({ arguments: flow.arguments, result: flow.result }, null, 2)}</pre>}
                  {isNavigation && <button type="button" onClick={() => navigate(targetPath(flow, databasePlants))} className="mx-2.5 mb-2 inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[10px] font-semibold text-teal-800 ring-1 ring-teal-200">Open {String(flow.result.view)} view</button>}
                  {isProposal && pendingPreview?.previewId === flow.result.preview_id && <div className="mx-2.5 mb-2 rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950"><p className="font-semibold">Schedule proposal preview</p><p className="mt-1 leading-5">{pendingPreview?.summary}</p><p className="mt-1 text-[10px]">Confirmation creates a pending recommendation for human review; it does not operate equipment.</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void confirmPreview(true)} disabled={mode !== 'automated'} className="inline-flex items-center gap-1 rounded bg-teal-800 px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-40"><Check size={12} /> Confirm proposal</button><button type="button" onClick={() => void confirmPreview(false)} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-700">Cancel</button></div>{mode !== 'automated' && <p className="mt-1.5 text-[10px]">Switch to Automated mode to submit this proposal.</p>}</div>}
                </div>
              })}</div> : null}
              {message.confirmed && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900">{message.confirmed}</p>}
            </div>}
          </article>)}
          {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800"><AlertCircle size={15} className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span>{failedQuestion && <button type="button" onClick={() => void send(failedQuestion, true)} className="shrink-0 font-bold underline">Retry</button>}</div>}
          <div ref={endRef} />
        </div>

        <form onSubmit={event => { event.preventDefault(); void send() }} className="shrink-0 border-t border-slate-200 bg-white p-3">
          <div className="flex items-end gap-2 rounded-lg border border-slate-300 p-2 focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/10">
            <textarea ref={inputRef} aria-label="Message GridSync Agent" rows={1} maxLength={4000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="Ask about a plant, block, meter or schedule…" className="max-h-28 min-h-9 flex-1 resize-y border-0 px-1 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0" />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send message" title="Send message" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-800 text-white hover:bg-teal-900 disabled:opacity-40"><Send size={15} /></button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-400">Enter to send · Shift+Enter for a new line · Esc to close</p>
        </form>
      </section>
    </>}
    <button ref={launcherRef} type="button" aria-label={open ? 'GridSync Agent open' : 'Open GridSync Agent'} aria-expanded={open} onClick={() => setOpen(value => !value)} className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-xl ring-1 ring-white/70 transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/30 md:bottom-6 md:right-6">
      {open ? <X size={21} /> : <BotMessageSquare size={22} />}
    </button>
  </>
}