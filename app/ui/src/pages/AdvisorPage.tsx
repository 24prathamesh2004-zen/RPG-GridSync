import { useEffect, useRef, useState } from 'react'
import { AlertCircle, BotMessageSquare, Plus, Send } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { askAdvisor, listPlants, type AdvisorMessage, type Plant } from '../services/api'

const advisorMarkdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-bold text-gray-900 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-bold text-gray-900 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-bold text-gray-900 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-zen-300 pl-3 text-gray-600">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-md border border-gray-200">
      <table className="w-full min-w-[520px] border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-100 text-gray-600">{children}</thead>,
  th: ({ children }) => <th className="border-b border-gray-200 px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-gray-100 px-3 py-2 align-top text-gray-700 last:border-0">{children}</td>,
  code: ({ children }) => <code className="rounded bg-gray-200/70 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  hr: () => <hr className="my-3 border-gray-200" />,
}

const STARTER_QUESTIONS = [
  'Which grid windows look best for flexible loads today?',
  'Explain the pending recommendations for this plant.',
  'When do this plant’s time-of-day tariff charges change?',
  'Estimate the value of shifting a 100 kW load for four hours.',
]

export default function AdvisorPage() {
  const [messages, setMessages] = useState<AdvisorMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [plants, setPlants] = useState<Plant[]>([])
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null)
  const [sessionId, setSessionId] = useState<string>()
  const [error, setError] = useState('')
  const [failedQuestion, setFailedQuestion] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listPlants()
      .then(response => {
        setPlants(response.data)
        setSelectedPlant(response.data[0] ?? null)
      })
      .catch(() => setError('Plant context could not be loaded. You can still ask a general question.'))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy, error])

  const startNewThread = () => {
    setMessages([])
    setInput('')
    setSessionId(undefined)
    setError('')
    setFailedQuestion('')
  }

  const changePlant = (plantId: string) => {
    const plant = plants.find(item => String(item.id) === plantId) ?? null
    if (plant?.id === selectedPlant?.id) return
    setSelectedPlant(plant)
    startNewThread()
  }

  const send = async (text = input, retry = false) => {
    const question = text.trim()
    if (!question || busy) return

    const priorMessages = retry ? messages.slice(0, -1) : messages
    if (!retry) setMessages([...messages, { role: 'user', content: question }])
    setInput('')
    setError('')
    setFailedQuestion('')
    setBusy(true)

    try {
      const response = await askAdvisor(
        question,
        selectedPlant?.id,
        priorMessages.slice(-10),
        sessionId,
      )
      setSessionId(response.data.session_id)
      setMessages([
        ...priorMessages,
        { role: 'user', content: question },
        { role: 'assistant', content: response.data.answer },
      ])
    } catch (requestError: unknown) {
      const detail = (requestError as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'The advisor could not respond. Check the connection and try again.')
      setFailedQuestion(question)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-132px)] min-h-[480px] max-w-5xl flex-col animate-fade-in">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Advisor</h2>
          <p className="mt-1 text-sm text-gray-500">Grounded explanations for energy, tariffs and scheduling decisions.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="advisor-plant" className="text-xs font-medium text-gray-500">Plant context</label>
          <select
            id="advisor-plant"
            value={selectedPlant?.id ?? ''}
            onChange={event => changePlant(event.target.value)}
            className="max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="">No plant</option>
            {plants.map(plant => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
          </select>
          <button
            onClick={startNewThread}
            disabled={busy || messages.length === 0}
            title="Start a new conversation"
            aria-label="Start a new conversation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-y border-gray-200 py-2 text-xs">
        <div className="flex items-center gap-2 text-gray-600">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>{selectedPlant ? `${selectedPlant.name} · ${selectedPlant.state} · Type ${selectedPlant.archetype}` : 'General energy guidance'}</span>
        </div>
        <span className="font-medium text-gray-400">Advisory only · no machine control</span>
      </div>

      <section aria-label="Advisor conversation" className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl py-5 sm:py-10">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zen-50 text-zen-700">
                  <BotMessageSquare size={21} />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">What would you like to understand?</h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selectedPlant ? `Using ${selectedPlant.name} signals and pending recommendations.` : 'Choose a plant to include its current signals and pending recommendations.'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {STARTER_QUESTIONS.map(question => (
                  <button
                    key={question}
                    onClick={() => void send(question)}
                    disabled={busy}
                    className="min-h-14 rounded-lg border border-gray-200 px-3 py-2.5 text-left text-sm text-gray-700 transition-colors hover:border-zen-300 hover:bg-zen-50/50 disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message, index) => (
                <div key={`${index}-${message.role}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'assistant' && (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zen-50 text-zen-700">
                      <BotMessageSquare size={15} />
                    </span>
                  )}
                  <div className={`max-w-[88%] sm:max-w-[80%] ${message.role === 'user' ? 'text-right' : ''}`}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      {message.role === 'user' ? 'You' : 'GridSync Advisor'}
                    </div>
                    <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'whitespace-pre-wrap bg-zen-700 text-white' : 'min-w-0 border border-gray-100 bg-gray-50 text-gray-800'}`}>
                      {message.role === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={advisorMarkdownComponents}>
                          {message.content}
                        </ReactMarkdown>
                      ) : message.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {busy && (
            <div className="mx-auto mt-5 flex max-w-3xl items-center gap-3 text-sm text-gray-500" role="status" aria-live="polite">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zen-50 text-zen-700"><BotMessageSquare size={15} /></span>
              <span className="animate-pulse">Checking plant context and preparing an answer…</span>
            </div>
          )}

          {error && (
            <div className="mx-auto mt-4 flex max-w-3xl items-start gap-3 border-l-2 border-rose-500 bg-rose-50 px-3 py-2.5 text-sm text-rose-800" role="alert">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="flex-1">{error}</div>
              {failedQuestion && <button onClick={() => void send(failedQuestion, true)} disabled={busy} className="shrink-0 font-semibold underline underline-offset-2">Retry</button>}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="border-t border-gray-100 bg-white p-3 sm:p-4"
          onSubmit={event => { event.preventDefault(); void send() }}
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-gray-200 bg-white p-2 focus-within:border-zen-400 focus-within:ring-2 focus-within:ring-zen-500/10">
            <textarea
              aria-label="Message the GridSync Advisor"
              className="max-h-32 min-h-10 flex-1 resize-y border-0 bg-transparent px-2 py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400 focus:ring-0"
              placeholder="Ask a follow-up about this plant, its tariffs or grid signals…"
              rows={1}
              maxLength={4000}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              title="Send message"
              aria-label="Send message"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zen-700 text-white hover:bg-zen-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </div>
          <div className="mx-auto mt-1.5 flex max-w-3xl justify-between px-1 text-[10px] text-gray-400">
            <span>Enter to send · Shift+Enter for a new line</span>
            <span>{input.length}/4000</span>
          </div>
        </form>
      </section>
    </div>
  )
}
