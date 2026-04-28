import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabaseRest, getCurrentUser } from '../lib/supabase'

const Ctx = createContext(null)

const S = { IDLE: 'idle', LISTENING: 'listening', PROCESSING: 'processing', ERROR: 'error' }

export function VoiceInputProvider({ children }) {
  const [state,    setState]    = useState(S.IDLE)
  const [errorMsg, setErrorMsg] = useState('')
  const [transcript, setTranscript] = useState('')
  const [toast,    setToast]    = useState(null)
  const [projects, setProjects] = useState([])
  const [team,     setTeam]     = useState([])
  const [pendingTask, setPendingTask] = useState(null)

  const recognitionRef = useRef(null)
  const finalRef       = useRef('')
  const toastTimerRef  = useRef(null)

  // Load projects/team once for parser context
  useEffect(() => {
    supabaseRest('projects', { select: 'id,name', filters: ['archived=eq.false'] })
      .then(({ data, error }) => {
        if (error) console.error('[Voice] projects:', error)
        setProjects(data ?? [])
      })
    supabaseRest('profiles', { select: 'id,full_name,email' })
      .then(({ data, error }) => {
        if (error) console.error('[Voice] profiles:', error)
        setTeam(data ?? [])
      })
  }, [])

  function showToast(message) {
    clearTimeout(toastTimerRef.current)
    setToast({ message })
    toastTimerRef.current = setTimeout(() => setToast(null), 3500)
  }

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setErrorMsg('Браузер не поддерживает распознавание речи. Используйте Chrome или Edge.')
      setState(S.ERROR)
      return
    }
    if (recognitionRef.current) return // already listening

    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'ru-RU'
    rec.continuous     = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    finalRef.current = ''
    setTranscript('')
    setErrorMsg('')

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalRef.current += t
        else interim += t
      }
      setTranscript(finalRef.current + interim)
    }

    rec.onerror = (e) => {
      // 'aborted' fires when we call .stop() — treat as normal stop, not error
      // 'no-speech' fires when nothing was said — also non-fatal
      if (e.error === 'aborted' || e.error === 'no-speech') return
      const msgs = {
        'not-allowed': 'Нет доступа к микрофону — разрешите его в браузере',
        'network':     'Ошибка сети при распознавании',
      }
      setErrorMsg(msgs[e.error] ?? `Ошибка: ${e.error}`)
      setState(S.ERROR)
    }

    rec.onend = () => {
      const text = finalRef.current.trim()
      finalRef.current = ''
      recognitionRef.current = null
      if (text) {
        processAndCreate(text)
      } else {
        setState(S.IDLE)
        setTranscript('')
      }
    }

    setState(S.LISTENING)
    try { rec.start() } catch (err) {
      console.error('[Voice] start failed:', err)
      setErrorMsg('Не удалось запустить распознавание')
      setState(S.ERROR)
    }
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
  }, [])

  // Insert a task using the resolved fields. Used by both the auto-flow
  // and the clarification confirmation.
  async function createTask({ title, assigned_to, project_id, deadline, voice_text }) {
    const user = getCurrentUser()
    const finalAssignee = assigned_to || user?.id || null
    const isDelegated   = finalAssignee && finalAssignee !== user?.id

    const result = await supabaseRest('tasks', {
      method: 'POST',
      body: {
        title,
        description: null,
        project_id:  project_id  || null,
        assignee_id: finalAssignee,
        due_date:    deadline    || null,
        priority:    'medium',
        status:      'pending',
        voice_text,
        created_by:  user?.id,
        sort_order:  Date.now() / 1000,
      },
    })
    if (result.error) throw new Error(result.error.message ?? 'Ошибка создания задачи')

    const createdTask = Array.isArray(result.data) ? result.data[0] : result.data

    if (isDelegated) {
      const notifRes = await supabaseRest('notifications', {
        method: 'POST',
        body: {
          user_id: finalAssignee,
          task_id: createdTask?.id,
          type:    'new_task',
          title:   `Вам назначена новая задача: ${title}`,
        },
      })
      if (notifRes.error) console.warn('[Voice] notification insert failed:', notifRes.error)
      const recipient = team.find(u => u.id === finalAssignee)
      const name = recipient?.full_name || recipient?.email || 'исполнителю'
      showToast(`✓ Задача отправлена ${name}`)
    } else {
      showToast(`✓ Задача создана: ${title}`)
    }

    window.dispatchEvent(new CustomEvent('voiceTaskCreated'))
    return createdTask
  }

  async function processAndCreate(text) {
    setState(S.PROCESSING)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, projects, team }),
      })
      const parsed = await res.json()
      if (!res.ok) throw new Error(parsed.error ?? 'Ошибка сервера')

      const title = (parsed.title ?? '').trim() || text
      const confidence = Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5
      const needsClarification = !parsed.assigned_to || confidence < 0.7

      if (needsClarification) {
        // Pause and ask the user. Pre-fill what Claude was sure about.
        setPendingTask({
          title,
          assigned_to: parsed.assigned_to ?? null,
          project_id:  parsed.project_id  ?? null,
          deadline:    parsed.deadline    ?? null,
          confidence,
          voice_text:  text,
        })
        setTranscript('')
        setState(S.IDLE)
        return
      }

      // Confidence high AND assignee set — create immediately
      await createTask({
        title,
        assigned_to: parsed.assigned_to,
        project_id:  parsed.project_id,
        deadline:    parsed.deadline,
        voice_text:  text,
      })
      setTranscript('')
      setState(S.IDLE)
    } catch (err) {
      console.error('[Voice] processAndCreate:', err)
      setErrorMsg(err.message)
      setState(S.ERROR)
      setTranscript('')
    }
  }

  async function confirmPendingTask({ assigned_to, project_id, deadline }) {
    if (!pendingTask) return
    setState(S.PROCESSING)
    try {
      await createTask({
        title:       pendingTask.title,
        assigned_to: assigned_to ?? pendingTask.assigned_to,
        project_id:  project_id  ?? pendingTask.project_id,
        deadline:    deadline    ?? pendingTask.deadline,
        voice_text:  pendingTask.voice_text,
      })
      setPendingTask(null)
      setState(S.IDLE)
    } catch (err) {
      console.error('[Voice] confirmPendingTask:', err)
      setErrorMsg(err.message)
      setState(S.ERROR)
    }
  }

  function cancelPendingTask() {
    setPendingTask(null)
    setState(S.IDLE)
  }

  const reset = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setState(S.IDLE)
    setErrorMsg('')
    setTranscript('')
  }, [])

  // Allow other code (Dashboard CTA, shortcuts) to start the FAB.
  useEffect(() => {
    const handler = () => {
      if (state === S.IDLE || state === S.ERROR) startListening()
    }
    window.addEventListener('voiceInputTrigger', handler)
    return () => window.removeEventListener('voiceInputTrigger', handler)
  }, [state, startListening])

  const value = {
    state, errorMsg, transcript, toast,
    isListening:  state === S.LISTENING,
    isProcessing: state === S.PROCESSING,
    isError:      state === S.ERROR,
    isIdle:       state === S.IDLE,
    startListening, stopListening, reset,
    projects, team,
    pendingTask, confirmPendingTask, cancelPendingTask,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVoiceInput() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVoiceInput must be inside VoiceInputProvider')
  return ctx
}
