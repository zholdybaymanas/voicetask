import { useState, useEffect } from 'react'
import { supabaseRest } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ROLE_LABEL = { admin: 'Администратор', manager: 'Менеджер', member: 'Участник' }
const ROLE_CLASS = {
  admin:   'bg-primary/15 text-primary',
  manager: 'bg-amber-500/15 text-amber-500',
  member:  'bg-hover text-muted',
}

export default function TeamPage() {
  const { profile } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', role: 'member', password: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadMembers() }, [])

  async function loadMembers() {
    setLoading(true)
    setError(null)
    try {
      const result = await supabaseRest('profiles', { filters: ['order=created_at.asc'] })
      if (result.error) throw new Error(result.error.message ?? JSON.stringify(result.error))
      setMembers(result.data ?? [])
    } catch (err) {
      console.error('[TeamPage] loadMembers:', err)
      setError(err.message ?? 'Не удалось загрузить команду')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    setSuccess('')
    if (!form.email.trim()) return setFormError('Введите email')
    if (!form.password || form.password.length < 6) return setFormError('Пароль минимум 6 символов')
    setSaving(true)

    let res, data
    try {
      res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'createUser',
          email:     form.email.trim(),
          password:  form.password,
          full_name: form.full_name.trim(),
          role:      form.role,
        }),
      })
      data = await res.json().catch(() => ({}))
    } catch (err) {
      console.error('[TeamPage] /api/admin fetch failed:', err)
      setSaving(false)
      return setFormError('Сервер недоступен. Запустите `npm run dev:api` или проверьте Vercel.')
    }
    setSaving(false)

    if (!res.ok) {
      console.error('[TeamPage] /api/admin error:', res.status, data)
      const raw = data.error ?? `Ошибка ${res.status}`
      if (/SERVICE_ROLE_KEY|SUPABASE_URL/i.test(raw)) {
        return setFormError(
          'Не настроен SUPABASE_SERVICE_ROLE_KEY. Добавьте его в .env (локально) или в Environment Variables в Vercel — см. DEPLOY.md.'
        )
      }
      return setFormError(raw)
    }
    setSuccess(`Пользователь ${form.email} создан`)
    setForm({ email: '', full_name: '', role: 'member', password: '' })
    loadMembers()
  }

  async function updateRole(userId, role) {
    const result = await supabaseRest('profiles', { method: 'PATCH', filters: [`id=eq.${userId}`], body: { role } })
    if (result.error) {
      console.error('[TeamPage] updateRole error:', result.error)
      return
    }
    setMembers(prev => prev.map(m => m.id === userId ? { ...m, role } : m))
  }

  const initials = (m) => (m.full_name ?? m.email ?? '?')[0].toUpperCase()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{members.length} участников</p>
        <button
          className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
          onClick={() => { setModalOpen(true); setFormError(''); setSuccess('') }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Добавить
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
          <p className="text-sm text-muted">{error}</p>
          <button className="btn-secondary text-sm" onClick={loadMembers}>Повторить</button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-hover transition-colors">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                  {initials(m)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">
                    {m.full_name || m.email}
                  </p>
                  {m.full_name && (
                    <p className="text-xs text-muted truncate">{m.email}</p>
                  )}
                </div>

                {isAdmin ? (
                  <select
                    value={m.role ?? 'member'}
                    onChange={e => updateRole(m.id, e.target.value)}
                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer outline-none appearance-none shrink-0 ${ROLE_CLASS[m.role ?? 'member']}`}
                  >
                    <option value="admin">Администратор</option>
                    <option value="manager">Менеджер</option>
                    <option value="member">Участник</option>
                  </select>
                ) : (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${ROLE_CLASS[m.role ?? 'member']}`}>
                    {ROLE_LABEL[m.role ?? 'member']}
                  </span>
                )}

                <span className="text-xs text-muted hidden md:block shrink-0">
                  {new Date(m.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text">Добавить пользователя</h2>
              <button onClick={() => setModalOpen(false)} className="text-muted hover:text-text">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {success ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-text mb-4">{success}</p>
                <button className="btn-primary" onClick={() => { setSuccess(''); setModalOpen(false) }}>Готово</button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Email *</label>
                  <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@company.com" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Имя</label>
                  <input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Иванов Иван" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Пароль *</label>
                  <input type="password" className="input" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Минимум 6 символов" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Роль</label>
                  <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    <option value="member">Участник</option>
                    <option value="manager">Менеджер</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>

                {formError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 break-words">{formError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Отмена</button>
                  <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
                    {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    Создать
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
