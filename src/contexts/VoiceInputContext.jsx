import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { supabaseRest, getCurrentUser, getAuthHeader } from '../lib/supabase'
import { syncTaskToGoogleCalendar } from '../lib/googleCalendar'

// Detect once at module load whether the browser can capture audio for
// Whisper (getUserMedia + MediaRecorder). Both have been supported on iOS
// Safari (incl. PWA) since 14.3, on Android Chrome forever, and on desktop
// Chromium/Firefox/Safari. If either is missing we surface a clear hint
// instead of a dead mic.
const hasMediaRecorder =
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

const voiceUnavailableReason = hasMediaRecorder
  ? null
  : 'Голосовой ввод не поддерживается этим браузером. Откройте сайт в Chrome, Safari или Edge.'
const voiceUnavailable = voiceUnavailableReason !== null

// Pick the best mime type the browser can record. Whisper accepts webm,
// mp4/m4a, mp3, wav, ogg — so we just hand it whatever the platform is
// happy to produce. iOS Safari only does mp4; everything else does webm.
function pickRecorderMimeType() {
  if (typeof window === 'undefined' || !window.MediaRecorder) return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported?.(t)) return t
  }
  return ''
}

const Ctx = createContext(null)

const S = { IDLE: 'idle', LISTENING: 'listening', PROCESSING: 'processing', ERROR: 'error' }

export function VoiceInputProvider({ children }) {
  const [state,    setState]    = useState(S.IDLE)
  const [errorMsg, setErrorMsg] = useState('')
  const [toast,    setToast]    = useState(null)
  const [projects, setProjects] = useState([])
  const [team,     setTeam]     = useState([])
  const [pendingTask, setPendingTask] = useState(null)

  const recorderRef       = useRef(null)
  const streamRef         = useRef(null)
  const chunksRef         = useRef([])
  const mimeRef           = useRef('')
  const toastTimerRef     = useRef(null)
  // True between startListening() and stopListening(). Used to abort an
  // in-flight start if the user releases the button before getUserMedia
  // resolves (touch hold-to-record).
  const wantsListeningRef = useRef(false)

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

  function releaseStream() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startListening = useCallback(async () => {
    if (voiceUnavailable) {
      setErrorMsg(voiceUnavailableReason)
      setState(S.ERROR)
      return
    }
    if (recorderRef.current || wantsListeningRef.current) return // already running / starting
    wantsListeningRef.current = true
    setErrorMsg('')

    // Request microphone — also surfaces the OS permission prompt on iOS.
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.error('[Voice] getUserMedia:', err)
      let msg = 'Доступ к микрофону запрещён.'
      if (err.name === 'NotAllowedError') {
        msg = 'Разрешите микрофон в настройках браузера для этого сайта.'
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

    // User released the button while we were waiting for the prompt — don't start.
    if (!wantsListeningRef.current) {
      stream.getTracks().forEach(t => t.stop())
      setState(S.IDLE)
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    const mimeType = pickRecorderMimeType()
    mimeRef.current = mimeType

    let recorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
    } catch (err) {
      console.error('[Voice] MediaRecorder ctor:', err)
      releaseStream()
      wantsListeningRef.current = false
      setErrorMsg('Не удалось запустить запись')
      setState(S.ERROR)
      return
    }
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onerror = (e) => {
      console.error('[Voice] recorder error:', e.error || e)
      wantsListeningRef.current = false
      recorderRef.current = null
      releaseStream()
      setErrorMsg('Ошибка записи звука')
      setState(S.ERROR)
    }

    recorder.onstop = async () => {
      const chunks = chunksRef.current
      chunksRef.current = []
      recorderRef.current = null
      releaseStream()

      const type = mimeRef.current || (chunks[0]?.type || 'audio/webm')
      const blob = new Blob(chunks, { type })

      // No audio captured (e.g. immediate release after threshold) — bail quietly.
      if (!blob.size) {
        setState(S.IDLE)
        return
      }

      try {
        await transcribeAndCreate(blob, type)
      } catch (err) {
        console.error('[Voice] transcribeAndCreate:', err)
        setErrorMsg(err.message || 'Не удалось обработать запись')
        setState(S.ERROR)
      }
    }

    setState(S.LISTENING)
    try {
      recorder.start()
    } catch (err) {
      console.error('[Voice] recorder.start:', err)
      recorderRef.current = null
      releaseStream()
      wantsListeningRef.current = false
      setErrorMsg('Не удалось запустить запись')
      setState(S.ERROR)
    }
  }, [])

  const stopListening = useCallback(() => {
    wantsListeningRef.current = false
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      // onstop handler kicks off transcription, so flip to PROCESSING now
      // for instant UI feedback (spinner). The state then either advances
      // through createTask → IDLE, or falls back to ERROR / clarification.
      setState(S.PROCESSING)
      try { rec.stop() } catch (err) {
        console.warn('[Voice] recorder.stop threw:', err)
      }
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

  function finishProcessing() {
    setState(prev => prev === S.PROCESSING ? S.IDLE : prev)
    setErrorMsg('')
  }

  async function transcribeAndCreate(blob, mimeType) {
    setState(S.PROCESSING)

    // Step 1: send audio to /api/whisper for transcription.
    const authHeaders = await getAuthHeader()
    const wr = await fetch('/api/whisper', {
      method:  'POST',
      headers: { 'Content-Type': mimeType || 'audio/webm', ...authHeaders },
      body:    blob,
    })
    const wj = await wr.json().catch(() => ({}))
    if (!wr.ok) throw new Error(wj.error ?? 'Ошибка распознавания')

    const text = (wj.transcript ?? '').trim()
    if (!text) {
      // Whisper returned nothing — likely silence. Quietly reset.
      setState(S.IDLE)
      return
    }

    // Step 2: hand the transcript off to the existing Haiku parser.
    const tr = await fetch('/api/tasks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body:    JSON.stringify({ transcript: text }),
    })
    const parsed = await tr.json()
    if (!tr.ok) throw new Error(parsed.error ?? 'Ошибка сервера')

    const title = (parsed.title ?? '').trim()

    // Clarification window only when there's nothing to put in title.
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
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      try { rec.stop() } catch {}
    }
    recorderRef.current = null
    chunksRef.current   = []
    releaseStream()
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
    voiceUnavailable, voiceUnavailableReason,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVoiceInput() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVoiceInput must be inside VoiceInputProvider')
  return ctx
}
