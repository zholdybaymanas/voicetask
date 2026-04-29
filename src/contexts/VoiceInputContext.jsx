import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabaseRest, getCurrentUser, getAuthHeader } from '../lib/supabase'
import { syncTaskToGoogleCalendar } from '../lib/googleCalendar'
import { isIOS } from '../lib/platform'

const Ctx = createContext(null)

const S = { IDLE: 'idle', LISTENING: 'listening', PROCESSING: 'processing', ERROR: 'error' }

export function VoiceInputProvider({ children }) {
  const [state,    setState]    = useState(S.IDLE)
  const [errorMsg, setErrorMsg] = useState('')
  const [toast,    setToast]    = useState(null)
  const [projects, setProjects] = useState([])
  const [team,     setTeam]     = useState([])
  const [pendingTask, setPendingTask] = useState(null)

  const recognitionRef    = useRef(null)
  const finalRef          = useRef('')
  const toastTimerRef     = useRef(null)
  // True between startListening() and stopListening() — used to abort
  // an in-flight start if the user releases before getUserMedia resolves
  // (touch hold-to-record).
  const wantsListeningRef = useRef(false)
  // Speech recognition language. Default ru-RU; flips to kk-KZ for the
  // *next* hold if the previous attempt produced no transcript, then
  // resets to ru-RU on any successful recognition.
  const langRef           = useRef('ru-RU')

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

  function showToast(payload) {
    clearTimeout(toastTimerRef.current)
    // Accept either a string (legacy short message) or a rich payload with
    // task details (project / assignee / deadline). Auto-hides after 3s so
    // VoiceInput.jsx can play the fade-out animation.
    const data = typeof payload === 'string' ? { message: payload } : payload
    setToast({ ...data, id: Date.now() })
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }

  function formatDeadlineRu(iso) {
    if (!iso) return null
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  }

  const startListening = useCallback(async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SR) {
      if (isIOS) {
        setErrorMsg('Голосовой ввод работает в Chrome на Android и компьютере. На iPhone откройте сайт в браузере Chrome.')
      } else {
        setErrorMsg('Браузер не поддерживает распознавание речи. Используйте Chrome или Edge.')
      }
      setState(S.ERROR)
      return
    }
    if (recognitionRef.current || wantsListeningRef.current) return // already listening / starting
    wantsListeningRef.current = true

    // Pre-flight: explicitly request microphone via getUserMedia.
    // On iOS this triggers the permission prompt that SpeechRecognition
    // does NOT trigger on its own. If denied here, we surface a clear
    // message instead of a silent failure.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // We only needed permission — release the stream immediately so
        // SpeechRecognition can claim the microphone itself.
        stream.getTracks().forEach(t => t.stop())
      }
    } catch (err) {
      console.error('[Voice] getUserMedia:', err)
      let msg = 'Доступ к микрофону запрещён.'
      if (err.name === 'NotAllowedError') {
        msg = isIOS
          ? 'Разрешите микрофон: aA → «Настройки веб-сайта» → Микрофон → Разрешить'
          : 'Разрешите микрофон в настройках браузера для этого сайта.'
      } else if (err.name === 'NotFoundError') {
        msg = 'Микрофон не найден на устройстве.'
      } else if (err.name === 'NotReadableError') {
        msg = 'Микрофон занят другим приложением.'
      }
      wantsListeningRef.current = false
      setErrorMsg(msg)
      setState(S.ERROR)
      return
    }

    // User may have released the button (mobile hold-to-record) while
    // we were waiting for the permission prompt — don't start in that case.
    if (!wantsListeningRef.current) {
      setState(S.IDLE)
      return
    }

    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = langRef.current
    if (langRef.current !== 'ru-RU') console.log('[Voice] retrying with lang:', langRef.current)
    // Continuous mode + auto-restart in onend (below) keeps recognition
    // running for the whole hold, even on iOS Safari which silently stops
    // mid-utterance. Stop is driven by user releasing the button.
    rec.continuous     = true
    rec.interimResults = false
    rec.maxAlternatives = 1

    finalRef.current = ''
    setErrorMsg('')

    rec.onresult = (e) => {
      // Only finals — we never display interim text. Accumulate into
      // finalRef so multiple onend→start cycles aggregate one transcript.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalRef.current += e.results[i][0].transcript + ' '
      }
    }

    rec.onerror = (e) => {
      // 'aborted' fires when we call .stop() — treat as normal stop, not error
      // 'no-speech' fires when SR couldn't pick up audio yet — non-fatal,
      //   onend will follow and the auto-restart loop keeps the session alive
      //   until the user releases the button.
      if (e.error === 'aborted' || e.error === 'no-speech') return
      const msgs = {
        'not-allowed':         'Нет доступа к микрофону — разрешите его в браузере',
        'service-not-allowed': 'Сервис распознавания заблокирован браузером',
        'network':             'Ошибка сети при распознавании',
        'audio-capture':       'Не удалось захватить звук с микрофона',
      }
      // Mark wants=false so the restart loop in onend doesn't fight the error.
      wantsListeningRef.current = false
      setErrorMsg(msgs[e.error] ?? `Ошибка распознавания: ${e.error}`)
      setState(S.ERROR)
    }

    rec.onend = () => {
      // If the user is still holding the button, SR ended on its own —
      // restart it. This is the workaround for iOS Safari (and silence
      // timeouts on Chrome) that auto-stops despite continuous=true.
      if (wantsListeningRef.current) {
        try {
          rec.start()
          return
        } catch (err) {
          // start() can throw if called too quickly — fall through to finish.
          console.warn('[Voice] auto-restart failed:', err)
        }
      }
      // User released → process accumulated text.
      const text = finalRef.current.trim()
      finalRef.current = ''
      recognitionRef.current = null
      if (text) {
        // Got something — reset to the default language for the next session.
        langRef.current = 'ru-RU'
        processAndCreate(text)
      } else {
        // Empty result — flip language so the next hold tries the other one.
        langRef.current = langRef.current === 'ru-RU' ? 'kk-KZ' : 'ru-RU'
        setState(S.IDLE)
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
    wantsListeningRef.current = false
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

    // Resolve human-readable bits for the toast card (project name,
    // assignee name, formatted deadline). Hidden when not present so the
    // card stays compact.
    const projectName = project_id
      ? (projects.find(p => p.id === project_id)?.name ?? null)
      : null
    const recipient    = team.find(u => u.id === finalAssignee)
    const assigneeName = isDelegated
      ? (recipient?.full_name || recipient?.email || 'исполнителю')
      : null
    const deadlineText = formatDeadlineRu(deadline)
    const headline     = isDelegated ? '✓ Задача отправлена' : '✓ Задача создана'

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
    }

    showToast({
      kind: 'task-created',
      headline,
      title,
      projectName,
      assigneeName,
      deadlineText,
    })

    window.dispatchEvent(new CustomEvent('voiceTaskCreated'))
    if (createdTask?.id) syncTaskToGoogleCalendar(createdTask.id)
    return createdTask
  }

  // Returns to IDLE only if we're still PROCESSING — using a functional
  // setState avoids clobbering a new LISTENING state if the user pressed
  // the mic again while the API call was in flight.
  function finishProcessing() {
    setState(prev => prev === S.PROCESSING ? S.IDLE : prev)
    setErrorMsg('')
  }

  async function processAndCreate(text) {
    setState(S.PROCESSING)
    try {
      const authHeaders = await getAuthHeader()
      // Server loads projects/team itself via the service-role key — we
      // only ship the transcript so an empty/late local cache can't
      // starve Haiku of context.
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ transcript: text }),
      })
      const parsed = await res.json()
      if (!res.ok) throw new Error(parsed.error ?? 'Ошибка сервера')

      const title = (parsed.title ?? '').trim()

      // Clarification window only when there's nothing to put in title.
      // If we have a title, create the task even without assignee/project —
      // the user can fill those in later from the task list.
      if (!title) {
        setPendingTask({
          title:       '',
          assigned_to: parsed.assigned_to ?? null,
          project_id:  parsed.project_id  ?? null,
          deadline:    parsed.deadline    ?? null,
          voice_text:  text,
        })
        finishProcessing()
        return
      }

      await createTask({
        title,
        assigned_to: parsed.assigned_to,
        project_id:  parsed.project_id,
        deadline:    parsed.deadline,
        voice_text:  text,
      })
      finishProcessing()
    } catch (err) {
      console.error('[Voice] processAndCreate:', err)
      setErrorMsg(err.message)
      setState(S.ERROR)
    }
  }

  async function confirmPendingTask({ title, assigned_to, project_id, deadline }) {
    if (!pendingTask) return
    setState(S.PROCESSING)
    try {
      await createTask({
        title:       (title ?? pendingTask.title ?? '').trim() || pendingTask.voice_text,
        assigned_to: assigned_to ?? pendingTask.assigned_to,
        project_id:  project_id  ?? pendingTask.project_id,
        deadline:    deadline    ?? pendingTask.deadline,
        voice_text:  pendingTask.voice_text,
      })
      setPendingTask(null)
      finishProcessing()
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
    wantsListeningRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setState(S.IDLE)
    setErrorMsg('')
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
    state, errorMsg, toast,
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
