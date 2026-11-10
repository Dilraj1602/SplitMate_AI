import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Check, LoaderCircle, Mic, Send, Square, X } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { api, ApiError } from '../services/api'

type Preview = { action: string; group: string; description: string; amount: string; currency: string; payer: string; recipient?: string; split_type: string; expense_date: string; participants: Array<{ name: string; amount: string }>; current_description?: string; current_amount?: string; available_amount?: string; settlement_status?: string }
type Reply = { message: string; intent?: string; missing_fields?: string[]; clarification_options?: Array<{ id?: string; name?: string; group_name?: string; members?: Array<{ id: string; name: string }> }>; pending_action_id?: string; action_preview?: Preview; confirmation_required?: boolean; data?: unknown; sources?: string[] }
type ChatItem = { role: 'user' | 'assistant'; reply?: Reply; text: string; pendingId?: string; preview?: Preview; actionState?: string }
type StoredMessage = { role: 'user' | 'assistant'; content: string }

export function AIAssistantPage() {
  const [items, setItems] = useState<ChatItem[]>([{ role: 'assistant', text: 'Hi! Ask about your balances or recent expenses, or describe an expense to prepare it for confirmation.' }])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conversationId, setConversationId] = useState<string>()
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | undefined>(undefined)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => {
    let active = true
    void api.get<{ data: Array<{ id: string }> }>('/ai/conversations').then(async response => {
      const first = response.data[0]
      if (!first) return
      const detail = await api.get<{ data: { id: string; messages: StoredMessage[]; actions: Array<{ id: string; status: string }> } }>(`/ai/conversations/${first.id}`)
      if (!active) return
      setConversationId(detail.data.id)
      const actionStates = new Map(detail.data.actions.map(action => [action.id, action.status]))
      const restored: ChatItem[] = detail.data.messages.map(entry => {
        if (entry.role === 'user') return { role: 'user', text: entry.content }
        try {
          const reply = JSON.parse(entry.content) as Reply & { execution_result?: { result?: Record<string, string> } }
          const result = reply.execution_result?.result
          const text = result && 'description' in result ? `${result.description} - ${result.currency || ''} ${result.total_amount || result.amount || ''} saved.` : reply.message || 'Assistant response'
          return { role: 'assistant', text, reply, pendingId: reply.pending_action_id, preview: reply.action_preview,
            actionState: reply.pending_action_id ? actionStates.get(reply.pending_action_id) : undefined }
        } catch { return { role: 'assistant', text: entry.content } }
      })
      setItems(restored.length ? restored : [{ role: 'assistant', text: 'Ask about balances or expenses, or describe a financial action to prepare it for confirmation.' }])
    }).catch(() => { /* New conversations remain available if history cannot load. */ })
    return () => { active = false; recorderRef.current?.stream.getTracks().forEach(track => track.stop()) }
  }, [])

  async function sendText(value: string) {
    const text = value.trim()
    if (!text || busy) return
    setError(''); setBusy(true); setMessage('')
    setItems(current => [...current, { role: 'user', text }])
    try {
      const response = await api.post<{ data: Reply & { conversation_id: string } }>('/ai/chat', { message: text, conversation_id: conversationId })
      setConversationId(response.data.conversation_id)
      setItems(current => [...current, { role: 'assistant', text: response.data.message, reply: response.data, pendingId: response.data.pending_action_id, preview: response.data.action_preview }])
    } catch (cause) {
      const safeMessage = cause instanceof ApiError ? cause.message : 'The request could not be completed.'
      setError(safeMessage)
    } finally { setBusy(false) }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    await sendText(message)
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Audio recording is not supported in this browser.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder; chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (!blob.size) { setError('No audio was recorded. Try again.'); return }
        setBusy(true); setError('')
        try {
          const form = new FormData()
          form.append('file', new File([blob], `recording.${recorder.mimeType.includes('webm') ? 'webm' : 'audio'}`, { type: recorder.mimeType || 'audio/webm' }))
          const response = await api.upload<{ data: { transcript: string } }>('/ai/voice/transcribe', form)
          setMessage(response.data.transcript)
        } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Audio transcription failed.') }
        finally { setBusy(false) }
      }
      recorder.start(); setRecording(true); setError('')
    } catch (cause) {
      setError(cause instanceof Error && cause.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access and try again.' : 'Could not start recording. Check microphone access and try again.')
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') { recorderRef.current.stop(); setRecording(false); setBusy(true) }
  }

  function newConversation() {
    setConversationId(undefined)
    setItems([{ role: 'assistant', text: 'Hi! Ask about your balances or recent expenses, or describe a financial action to prepare it for confirmation.' }])
    setMessage(''); setError('')
  }

  async function decide(item: ChatItem, decision: 'confirm' | 'cancel') {
    if (!item.pendingId || busy) return
    setBusy(true); setError('')
    try {
      if (decision === 'cancel') {
        await api.post(`/ai/actions/${item.pendingId}/cancel`)
        setItems(current => current.map(row => row.pendingId === item.pendingId ? { ...row, actionState: 'cancelled' } : row))
        setItems(current => [...current, { role: 'assistant', text: 'The pending action was cancelled.' }])
      } else {
        const result = await api.post<{ data: { result: { description?: string; total_amount?: string; amount?: string; currency?: string; status?: string }; duplicate?: boolean } }>(`/ai/actions/${item.pendingId}/confirm`)
        const saved = result.data.result
        const detail = saved.description ? `${saved.description} — ${saved.currency} ${saved.total_amount}` : `Settlement — ${saved.currency} ${saved.amount}`
        const outcome = saved.status === 'pending' ? 'was proposed and is waiting for the recipient to confirm' : 'was recorded successfully'
        setItems(current => current.map(row => row.pendingId === item.pendingId ? { ...row, actionState: 'executed' } : row))
        setItems(current => [...current, { role: 'assistant', text: `${detail} ${outcome}${result.data.duplicate ? ' (this action was already completed)' : ''}.` }])
      }
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The action could not be completed.') }
    finally { setBusy(false) }
  }

  return <><PageHeader title="AI assistant" description="Ask about your SplitMate data or prepare an expense in plain language." action={<button className="button button-outline" type="button" onClick={newConversation} disabled={busy || recording}>New chat</button>} />
    <section className="ai-chat-panel" aria-label="SplitMate AI conversation">
      <div className="ai-chat-history" aria-live="polite">{items.map((item, index) => <article className={`ai-message ai-message-${item.role}`} key={index}><div className="ai-message-icon">{item.role === 'assistant' ? <Bot size={17}/> : 'You'}</div><div className="ai-message-body"><p>{item.text}</p>{item.reply?.missing_fields?.length ? <small>Needed: {item.reply.missing_fields.join(', ')}</small> : null}{item.reply?.sources?.length ? <small>Sources: {item.reply.sources.join(', ')}</small> : null}{item.reply?.clarification_options?.map((option, i) => option.members?.length ? <span className="ai-option-group" key={option.id || i}>{option.members.map(person => <button type="button" className="ai-option ai-option-button" key={person.id} onClick={() => void sendText(person.name)}>{person.name}</button>)}</span> : <button type="button" className="ai-option ai-option-button" key={option.id || i} onClick={() => void sendText(option.group_name ? `The ${option.name} expense in ${option.group_name}` : option.name || '')}>{option.group_name ? `${option.name || 'Expense'} · ${option.group_name}` : option.name}</button>)}{item.preview && <div className="ai-preview"><h3>{item.preview.action}</h3><dl><dt>Description</dt><dd>{item.preview.description}</dd><dt>Group</dt><dd>{item.preview.group}</dd><dt>Amount</dt><dd>{item.preview.currency} {item.preview.amount}</dd><dt>Paid by</dt><dd>{item.preview.payer}</dd>{item.preview.recipient && <><dt>Received by</dt><dd>{item.preview.recipient}</dd></>}{item.preview.current_description && <><dt>Current description</dt><dd>{item.preview.current_description}</dd></>}{item.preview.current_amount && <><dt>Current amount</dt><dd>{item.preview.currency} {item.preview.current_amount}</dd></>}{item.preview.available_amount && <><dt>Available balance</dt><dd>{item.preview.currency} {item.preview.available_amount}</dd></>}<dt>Details</dt><dd>{item.preview.split_type}</dd>{item.preview.participants.map(person => <div className="ai-preview-share" key={person.name}><dt>{person.name}</dt><dd>{item.preview?.currency} {person.amount}</dd></div>)}</dl>{item.preview.settlement_status && <p>{item.preview.settlement_status}</p>}<small>Date: {item.preview.expense_date}</small>{item.pendingId && (item.actionState === 'pending' || !item.actionState) ? <div className="ai-preview-actions"><button type="button" className="button button-primary" onClick={() => void decide(item, 'confirm')} disabled={busy}><Check size={16}/>Confirm action</button><button type="button" className="button button-outline" onClick={() => void decide(item, 'cancel')} disabled={busy}><X size={16}/>Cancel</button></div> : item.actionState && <small>Action {item.actionState}</small>}</div>}</div></article>)}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {message && <p className="ai-transcript-hint">Transcript is editable. Review it before sending.</p>}
      <form className="ai-chat-form" onSubmit={send}><label className="sr-only" htmlFor="ai-message">Message the assistant</label><textarea id="ai-message" value={message} onChange={event => setMessage(event.target.value)} placeholder="For example: I paid ₹1,200 for dinner in Goa Trip" maxLength={4000} rows={2} disabled={busy || recording}/><button type="button" className="button button-outline" onClick={() => recording ? stopRecording() : void startRecording()} disabled={busy && !recording} aria-label={recording ? 'Stop recording' : 'Record voice'}>{recording ? <><Square size={16}/>Stop</> : <><Mic size={16}/>Voice</>}</button><button type="submit" className="button button-primary" disabled={busy || recording || !message.trim()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>}Send</button></form>
    </section>
  </>
}
