import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../contexts/ThemeContext'
import { supabase, supabasePatch } from '../lib/supabase'
import {
  startGoogleCalendarConnect,
  getGoogleCalendarStatus,
  disconnectGoogleCalendar,
} from '../lib/googleCalendar'

const APP_VERSION = '0.1.0'
const SUPPORT_EMAIL = 'support@voicetask.app'

const NOTIF_DAILY_KEY  = 'voicetask:notif:daily'
const NOTIF_WEEKLY_KEY = 'voicetask:notif:weekly'
const NOTIF_SOUND_KEY  = 'voicetask:notif:sound'
const LANG_KEY         = 'voicetask:lang'

function readBool(key, defaultValue = true) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return defaultValue
    return v !== 'off'
  } catch { return defaultValue }
}

export default function SettingsPage() {
  return (
    <div className="space-y-5 max-w-2xl">
      <Section title="Оформление" subtitle="Цветовая тема приложения">
        <ThemeGrid />
      </Section>

      <Section title="Аккаунт" subtitle="Имя, email и пароль">
        <AccountForm />
      </Section>

      <Section title="Интеграции" subtitle="Внешние сервисы">
        <IntegrationsSettings />
      </Section>

      <Section title="Уведомления" subtitle="Push, отчёты и звуки">
        <NotificationsSettings />
      </Section>

      <Section title="Язык" subtitle="Язык интерфейса">
        <LanguageSelect />
      </Section>

      <Section title="О приложении">
        <AboutInfo />
      </Section>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <section className="bg-card border border-border rounded-xl shadow-card p-5 sm:p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

// ───────────────────────────── Theme picker ─────────────────────────────

function ThemeGrid() {
  const { theme, setTheme, themes } = useTheme()
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {themes.map(t => {
        const active = t.id === theme
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className="flex flex-col items-center gap-2 group focus:outline-none"
          >
            <span
              className="block w-12 h-12 rounded-full transition-all"
              style={{
                background: t.swatch,
                border: `2px solid ${active ? t.accent : t.borderColor}`,
                boxShadow: active
                  ? `0 0 0 2px rgb(var(--bg-rgb)), 0 0 0 4px ${t.accent}`
                  : 'none',
              }}
            />
            <span className={`text-xs font-medium text-center ${active ? 'text-text' : 'text-muted group-hover:text-text'}`}>
              {t.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ───────────────────────────── Account ─────────────────────────────

function AccountForm() {
  const { user, profile } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [email,    setEmail]    = useState(user?.email ?? '')
  const [password, setPassword] = useState('')

  const [savingName, setSavingName]       = useState(false)
  const [savingEmail, setSavingEmail]     = useState(false)
  const [savingPwd, setSavingPwd]         = useState(false)
  const [msg, setMsg]                     = useState(null) // {kind: 'ok'|'err', text}

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
  }, [profile])
  useEffect(() => {
    setEmail(user?.email ?? '')
  }, [user])

  function flash(kind, text) {
    setMsg({ kind, text })
    setTimeout(() => setMsg(null), 4000)
  }

  async function saveName() {
    if (!user?.id) return
    const trimmed = fullName.trim()
    if (!trimmed) return flash('err', 'Имя не может быть пустым')
    setSavingName(true)
    const { error } = await supabasePatch('profiles', user.id, { full_name: trimmed })
    setSavingName(false)
    if (error) flash('err', error.message ?? 'Не удалось сохранить имя')
    else flash('ok', 'Имя обновлено')
  }

  async function saveEmail() {
    const trimmed = email.trim()
    if (!trimmed || trimmed === user?.email) return
    setSavingEmail(true)
    const { error } = await supabase.auth.updateUser({ email: trimmed })
    setSavingEmail(false)
    if (error) flash('err', error.message ?? 'Не удалось сменить email')
    else flash('ok', 'Подтвердите смену email — на новый адрес отправлено письмо')
  }

  async function savePassword() {
    if (password.length < 6) return flash('err', 'Пароль минимум 6 символов')
    setSavingPwd(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSavingPwd(false)
    if (error) flash('err', error.message ?? 'Не удалось сменить пароль')
    else { flash('ok', 'Пароль обновлён'); setPassword('') }
  }

  return (
    <div className="space-y-4">
      <Field label="Имя">
        <div className="flex gap-2">
          <input className="input flex-1" value={fullName} onChange={e => setFullName(e.target.value)} />
          <button className="btn-primary text-sm flex items-center gap-2" onClick={saveName} disabled={savingName}>
            {savingName && <Spinner />}
            Сохранить
          </button>
        </div>
      </Field>

      <Field label="Email">
        <div className="flex gap-2">
          <input type="email" className="input flex-1" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn-primary text-sm flex items-center gap-2" onClick={saveEmail} disabled={savingEmail || email === user?.email}>
            {savingEmail && <Spinner />}
            Сменить
          </button>
        </div>
      </Field>

      <Field label="Новый пароль">
        <div className="flex gap-2">
          <input
            type="password"
            className="input flex-1"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Минимум 6 символов"
            autoComplete="new-password"
          />
          <button className="btn-primary text-sm flex items-center gap-2" onClick={savePassword} disabled={savingPwd || !password}>
            {savingPwd && <Spinner />}
            Сменить
          </button>
        </div>
      </Field>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-lg break-words ${
          msg.kind === 'ok'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}

// ───────────────────────────── Notifications ─────────────────────────────

function NotificationsSettings() {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [perm,   setPerm]   = useState(supported ? Notification.permission : 'denied')
  const [daily,  setDaily]  = useState(() => readBool(NOTIF_DAILY_KEY))
  const [weekly, setWeekly] = useState(() => readBool(NOTIF_WEEKLY_KEY))
  const [sound,  setSound]  = useState(() => readBool(NOTIF_SOUND_KEY))

  function persist(key, value) {
    try { localStorage.setItem(key, value ? 'on' : 'off') } catch {}
  }
  useEffect(() => persist(NOTIF_DAILY_KEY, daily),   [daily])
  useEffect(() => persist(NOTIF_WEEKLY_KEY, weekly), [weekly])
  useEffect(() => persist(NOTIF_SOUND_KEY, sound),   [sound])

  async function request() {
    if (!supported) return
    const p = await Notification.requestPermission()
    setPerm(p)
  }

  if (!supported) {
    return <p className="text-sm text-muted">Браузер не поддерживает push-уведомления.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text">Системные уведомления</p>
          <p className="text-xs text-muted mt-0.5">
            {perm === 'granted' && 'Разрешены'}
            {perm === 'denied'  && 'Заблокированы — измените в настройках браузера'}
            {perm === 'default' && 'Не запрошены'}
          </p>
        </div>
        {perm === 'default' && (
          <button className="btn-primary text-xs" onClick={request}>Разрешить</button>
        )}
      </div>

      <ToggleRow
        label="Ежедневный отчёт"
        sub="Каждый день в 18:00"
        value={daily}
        onChange={setDaily}
      />
      <ToggleRow
        label="Еженедельный отчёт"
        sub="Пятница, 17:00"
        value={weekly}
        onChange={setWeekly}
      />
      <ToggleRow
        label="Звук уведомлений"
        sub="Звуковой сигнал при тостах"
        value={sound}
        onChange={setSound}
      />
    </div>
  )
}

// ───────────────────────────── Integrations ─────────────────────────────

function IntegrationsSettings() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [status, setStatus] = useState(null) // {connected, email}
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flash, setFlashMsg] = useState(null)

  function showFlash(kind, text) {
    setFlashMsg({ kind, text })
    setTimeout(() => setFlashMsg(null), 4000)
  }

  async function refresh() {
    setLoading(true)
    const s = await getGoogleCalendarStatus()
    setStatus(s)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [user?.id])

  // Pick up post-OAuth redirect: /settings?gcal=connected | error
  useEffect(() => {
    const r = searchParams.get('gcal')
    if (!r) return
    if (r === 'connected') showFlash('ok', 'Google Calendar подключён')
    else showFlash('err', `Не удалось подключить Google Calendar: ${searchParams.get('reason') ?? r}`)
    // Clean the URL
    const next = new URLSearchParams(searchParams)
    next.delete('gcal')
    next.delete('reason')
    setSearchParams(next, { replace: true })
    refresh()
  }, [searchParams])

  async function connect() {
    if (!user?.id) return
    setBusy(true)
    try {
      await startGoogleCalendarConnect()
      // ↑ navigates away on success; the line below only runs on error
    } catch (err) {
      console.error('[settings] connect:', err)
      showFlash('err', err.message ?? 'Не удалось начать подключение')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!confirm('Отключить Google Calendar? События в календаре останутся.')) return
    setBusy(true)
    const ok = await disconnectGoogleCalendar()
    setBusy(false)
    if (ok) {
      showFlash('ok', 'Google Calendar отключён')
      refresh()
    } else {
      showFlash('err', 'Не удалось отключить')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-hover flex items-center justify-center shrink-0">
          {/* Calendar icon */}
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text">Google Calendar</p>
          <p className="text-xs text-muted mt-0.5">
            {loading
              ? 'Загрузка…'
              : status?.connected
                ? `Подключено${status.email ? ' · ' + status.email : ''}`
                : 'Не подключено'}
          </p>
          <p className="text-xs text-muted mt-1">
            Задачи с дедлайном автоматически попадают в ваш календарь.
          </p>
        </div>
        {!loading && (
          status?.connected ? (
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="btn-secondary text-xs shrink-0"
            >
              {busy ? '…' : 'Отключить'}
            </button>
          ) : (
            <button
              type="button"
              onClick={connect}
              className="btn-primary text-xs shrink-0"
            >
              Подключить
            </button>
          )
        )}
      </div>

      {flash && (
        <p className={`text-xs px-3 py-2 rounded-lg break-words ${
          flash.kind === 'ok'
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {flash.text}
        </p>
      )}
    </div>
  )
}

function ToggleRow({ label, sub, value, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${value ? 'bg-primary' : 'bg-hover border border-border'}`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : ''}`}
        />
      </button>
    </label>
  )
}

// ───────────────────────────── Language ─────────────────────────────

function LanguageSelect() {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem(LANG_KEY) || 'ru' } catch { return 'ru' }
  })
  function pick(v) {
    setLang(v)
    try { localStorage.setItem(LANG_KEY, v) } catch {}
  }
  return (
    <div className="space-y-2">
      <Choice value="ru" current={lang} onPick={pick} title="Русский" sub="" />
      <Choice value="kz" current={lang} onPick={pick} title="Қазақша" sub="В разработке" />
    </div>
  )
}

function Choice({ value, current, onPick, title, sub }) {
  const active = value === current
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
        active ? 'border-primary bg-primary/5' : 'border-border hover:bg-hover'
      }`}
    >
      <div className="text-left">
        <p className="text-sm font-medium text-text">{title}</p>
        {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
      </div>
      {active && (
        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </button>
  )
}

// ───────────────────────────── About ─────────────────────────────

function AboutInfo() {
  return (
    <div className="space-y-2 text-sm">
      <Row label="Версия" value={APP_VERSION} />
      <Row label="Поддержка" value={
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
          {SUPPORT_EMAIL}
        </a>
      } />
      <Row label="Сделано на" value="React + Vite + Supabase + Claude Haiku" />
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-text text-right break-words">{value}</span>
    </div>
  )
}

// ───────────────────────────── Helpers ─────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Spinner() {
  return <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
}
