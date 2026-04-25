import { useState, useRef, useEffect, useCallback } from 'react'
import { supabaseRest, getCurrentUser } from '../lib/supabase'

const S = { IDLE: 'idle', LISTENING: 'listening', PROCESSING: 'processing', ERROR: 'error' }

export default function VoiceInput() {
  const [state, setState]     = useState(S.IDLE)
  const [errorMsg, setErrorMsg] = useState('')
  const [toast, setToast]     = useState(null)   // { message }
  const [projects, setProjects] = useState([])
  const [team, setTeam]       = useState([])
  const recognitionRef        = useRef(null)
  const toastTimerRef         = useRef(null)

  useEffect(() => {
    supabaseRest('projects', { select: 'id,name', filters: ['archived=eq.false'] })
      .then(({ data, error }) => {
        if (error) console.error('[VoiceInput] projects:', error)
        setProjects(data ?? [])
      })
    supabaseRest('profiles', { select: 'id,full_name,email' })
      .then(({ data, error }) => {
        if (error) console.error('[VoiceInput] profiles:', error)
        setTeam(data ?? [])
      })
  }, [])

  function showToast(message) {
    clearTimeout(toastTimerRef.current)
    setToast({ message })
    toastTimerRef.current = setTimeout(() => setToast(null), 3500)
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setErrorMsg('Браузер не поддерживает распознавание речи. Используйте Chrome или Edge.')
      setState(S.ERROR)
      return
    }
    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'ru-RU'
    rec.continuous = false
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      const text = e.results[0][0].transcript
      processAndCreate(text)
    }
    rec.onerror = (e) => {
      const msgs = {
        'not-allowed': 'Нет доступа к микрофону — разрешите его в браузере',
        'no-speech':   'Речь не обнаружена, попробуйте ещё раз',
        'network':     'Ошибка сети при распознавании',
      }
      setErrorMsg(msgs[e.error] ?? `Ошибка: ${e.error}`)
      setState(S.ERROR)
    }
    rec.onend = () => { recognitionRef.current = null }

    setState(S.LISTENING)
    rec.start()
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setState(S.IDLE)
  }

  async function processAndCreate(text) {
    setState(S.PROCESSING)
    try {
      // 1. Parse transcript via Claude
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, projects, team }),
      })
      const parsed = await res.json()
      if (!res.ok) throw new Error(parsed.error ?? 'Ошибка сервера')

      const title = parsed.title?.trim() || text

      // 2. Insert directly into Supabase — no modal
      const user = getCurrentUser()
      const result = await supabaseRest('tasks', {
        method: 'POST',
        body: {
          title,
          description: parsed.description  || null,
          project_id:  parsed.project_id   || null,
          assignee_id: parsed.assignee_id  || null,
          due_date:    parsed.due_date     || null,
          priority:    parsed.priority     ?? 'medium',
          status:      'todo',
          voice_text:  text,
          created_by:  user?.id,
        },
      })
      if (result.error) throw new Error(result.error.message ?? 'Ошибка создания задачи')

      // 3. Notify other components + show toast
      window.dispatchEvent(new CustomEvent('voiceTaskCreated'))
      showToast(`✓ Задача создана: ${title}`)
      setState(S.IDLE)
    } catch (err) {
      console.error('[VoiceInput] processAndCreate error:', err)
      setErrorMsg(err.message)
      setState(S.ERROR)
    }
  }

  function reset() {
    recognitionRef.current?.stop()
    setState(S.IDLE)
    setErrorMsg('')
  }

  const fabLabel = state === S.LISTENING ? 'Остановить' : state === S.PROCESSING ? 'Обработка...' : null

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 sm:bottom-24 right-4 sm:right-7 z-50 animate-in">
          <div className="bg-slate-900 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 max-w-xs">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <span className="truncate">{toast.message}</span>
          </div>
        </div>
      )}

      {/* FAB */}
      <div className="group fixed bottom-5 sm:bottom-7 right-4 sm:right-7 z-40 flex items-center gap-3">
        <span className="hidden sm:inline-block pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-slate-800 text-white text-xs font-medium rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
          {fabLabel ?? 'Голосовая задача'}
        </span>

        <button
          onClick={state === S.LISTENING ? stopListening : startListening}
          disabled={state === S.PROCESSING}
          aria-label="Голосовая задача"
          className={`
            relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center
            transition-all duration-200 hover:scale-105 active:scale-95
            disabled:opacity-60 disabled:cursor-not-allowed
            ${state === S.LISTENING ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary-dark'}
          `}
        >
          {state === S.LISTENING && (
            <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-50" />
          )}
          {state === S.PROCESSING ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-6 h-6 text-white relative" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>
      </div>

      {/* Error modal */}
      {state === S.ERROR && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={reset} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-3">Ошибка</h2>
            <div className="flex gap-3 items-start bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl p-3 mb-5">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
              </svg>
              <span>{errorMsg}</span>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={reset}>Закрыть</button>
              <button className="btn-primary" onClick={() => { reset(); startListening() }}>
                Попробовать снова
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
