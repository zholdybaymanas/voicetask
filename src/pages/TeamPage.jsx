import { useState, useEffect, useRef } from 'react'
import { supabaseRest, getAuthHeader } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../contexts/ToastContext'

const ROLE_LABEL = { admin: 'Администратор', manager: 'Менеджер', member: 'Участник' }
const ROLE_CLASS = {
  admin:   'bg-primary/15 text-primary',
  manager: 'bg-amber-500/15 text-amber-500',
  member:  'bg-hover text-muted',
}

function isBanned(member) {
  if (!member?.banned_until) return false
  return new Date(member.banned_until) > new Date()
}

export default function TeamPage() {
  const { profile, user } = useAuth()
  const { show: showToast } = useToast()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const [createOpen,    setCreateOpen]    = useState(false)
  const [createForm,    setCreateForm]    = useState({ email: '', full_name: '', password: '', role: 'member' })
  const [showPassword,  setShowPassword]  = useState(false)
  const [createSaving,  setCreateSaving]  = useState(false)
  const [createError,   setCreateError]   = useState('')
  // On success we keep email + password around so the admin can hand
  // them to the new user (manual delivery — no SMTP in v1.0).
  const [createdAccount, setCreatedAccount] = useState(null)
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied'

  const [openMenuId, setOpenMenuId] = useState(null)
  const [pendingActionId, setPendingActionId] = useState(null) // member.id while ban/unban in flight
  const [confirmDelete, setConfirmDelete] = useState(null)     // full member object pending deletion
  const [deleting, setDeleting] = useState(false)
  const menuContainerRef = useRef(null)

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadMembers() }, [])

  // Close the 3-dot menu when clicking elsewhere on the page.
  useEffect(() => {
    function onClick(e) {
      if (!menuContainerRef.current) return
      if (!menuContainerRef.current.contains(e.target)) setOpenMenuId(null)
    }
    if (openMenuId) {
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }
  }, [openMenuId])

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

  async function callAdmin(body) {
    const authHeaders = await getAuthHeader()
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
    return data
  }

  function openCreate() {
    setCreateForm({ email: '', full_name: '', password: '', role: 'member' })
    setShowPassword(false)
    setCreateError('')
    setCreatedAccount(null)
    setCopyState('idle')
    setCreateOpen(true)
  }

  function closeCreate() {
    setCreateOpen(false)
    setCreatedAccount(null)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreateError('')
    if (!createForm.email.trim())                   return setCreateError('Введите email')
    if (!createForm.password || createForm.password.length < 6) return setCreateError('Пароль минимум 6 символов')

    setCreateSaving(true)
    try {
      await callAdmin({
        action:    'createUser',
        email:     createForm.email.trim(),
        password:  createForm.password,
        full_name: createForm.full_name.trim(),
        role:      createForm.role,
      })
      // Hold onto the credentials so the admin can copy them once.
      setCreatedAccount({ email: createForm.email.trim(), password: createForm.password })
      loadMembers()
    } catch (err) {
      console.error('[TeamPage] createUser:', err)
      if (/SERVICE_ROLE_KEY|SUPABASE_URL/i.test(err.message)) {
        setCreateError('Не настроен SUPABASE_SERVICE_ROLE_KEY. См. DEPLOY.md.')
      } else {
        setCreateError(err.message)
      }
    } finally {
      setCreateSaving(false)
    }
  }

  async function copyCredentials() {
    if (!createdAccount) return
    const text = `Email: ${createdAccount.email}\nПароль: ${createdAccount.password}`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1500)
    } catch (err) {
      console.warn('[TeamPage] clipboard failed:', err)
      showToast('Не удалось скопировать в буфер', 'error')
    }
  }

  async function updateRole(userId, role) {
    const result = await supabaseRest('profiles', { method: 'PATCH', filters: [`id=eq.${userId}`], body: { role } })
    if (result.error) {
      console.error('[TeamPage] updateRole error:', result.error)
      showToast(result.error.message ?? 'Не удалось изменить роль', 'error')
      return
    }
    setMembers(prev => prev.map(m => m.id === userId ? { ...m, role } : m))
  }

  async function banMember(member) {
    setOpenMenuId(null)
    setPendingActionId(member.id)
    try {
      const data = await callAdmin({ action: 'banUser', user_id: member.id })
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, banned_until: data.banned_until } : m))
      showToast(`${member.full_name || member.email} заблокирован`, 'success')
    } catch (err) {
      console.error('[TeamPage] ban:', err)
      showToast(err.message, 'error')
    } finally {
      setPendingActionId(null)
    }
  }

  async function unbanMember(member) {
    setOpenMenuId(null)
    setPendingActionId(member.id)
    try {
      await callAdmin({ action: 'unbanUser', user_id: member.id })
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, banned_until: null } : m))
      showToast(`${member.full_name || member.email} разблокирован`, 'success')
    } catch (err) {
      console.error('[TeamPage] unban:', err)
      showToast(err.message, 'error')
    } finally {
      setPendingActionId(null)
    }
  }

  async function deleteMember(member) {
    setDeleting(true)
    try {
      await callAdmin({ action: 'deleteUser', user_id: member.id })
      setMembers(prev => prev.filter(m => m.id !== member.id))
      showToast(`${member.full_name || member.email} удалён`, 'success')
      setConfirmDelete(null)
    } catch (err) {
      console.error('[TeamPage] delete:', err)
      showToast(err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const initials = (m) => (m.full_name ?? m.email ?? '?')[0].toUpperCase()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{members.length} участников</p>
        {isAdmin && (
          <button
            className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
            onClick={openCreate}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            <span className="hidden sm:inline">Добавить участника</span>
            <span className="sm:hidden">Добавить</span>
          </button>
        )}
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
        <div className="card p-0 overflow-hidden" ref={menuContainerRef}>
          <div className="divide-y divide-border">
            {members.map(m => {
              const banned = isBanned(m)
              const isSelf = m.id === user?.id
              const busy   = pendingActionId === m.id
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 transition-colors ${banned ? 'opacity-60' : ''} hover:bg-hover`}
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {initials(m)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text truncate">
                        {m.full_name || m.email}
                      </p>
                      {banned && (
                        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 shrink-0">
                          Заблокирован
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-hover text-muted shrink-0">
                          Вы
                        </span>
                      )}
                    </div>
                    {m.full_name && (
                      <p className="text-xs text-muted truncate">{m.email}</p>
                    )}
                  </div>

                  {isAdmin ? (
                    <select
                      value={m.role ?? 'member'}
                      onChange={e => updateRole(m.id, e.target.value)}
                      className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer outline-none appearance-none shrink-0 ${ROLE_CLASS[m.role ?? 'member']}`}
                      disabled={isSelf}
                      title={isSelf ? 'Нельзя изменить свою роль здесь' : undefined}
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

                  {/* 3-dot menu — admin only, not on self */}
                  {isAdmin && !isSelf && (
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                        disabled={busy}
                        className="text-muted hover:text-text p-1.5 rounded-lg hover:bg-hover disabled:opacity-50"
                        aria-label="Действия"
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === m.id}
                      >
                        {busy ? (
                          <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 5.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                          </svg>
                        )}
                      </button>

                      {openMenuId === m.id && (
                        <div
                          role="menu"
                          className="absolute right-0 top-full mt-1 z-20 min-w-[180px] bg-card border border-border rounded-lg shadow-card-hover py-1"
                        >
                          {banned ? (
                            <button
                              role="menuitem"
                              onClick={() => unbanMember(m)}
                              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-hover flex items-center gap-2"
                            >
                              <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round"
                                  d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                              </svg>
                              Разблокировать
                            </button>
                          ) : (
                            <button
                              role="menuitem"
                              onClick={() => banMember(m)}
                              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-hover flex items-center gap-2"
                            >
                              <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round"
                                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                              </svg>
                              Заблокировать
                            </button>
                          )}
                          <button
                            role="menuitem"
                            onClick={() => { setOpenMenuId(null); setConfirmDelete(m) }}
                            className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 flex items-center gap-2"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round"
                                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add-member modal — direct account creation. SMTP intentionally
          unused in v1.0; admin shares credentials with the user manually. */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeCreate} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text">
                {createdAccount ? 'Аккаунт создан' : 'Добавить участника'}
              </h2>
              <button onClick={closeCreate} className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {createdAccount ? (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="w-12 h-12 bg-emerald-500/15 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                </div>

                <p className="text-sm text-muted text-center">
                  Передайте участнику данные для входа:
                </p>

                <div className="bg-hover rounded-lg p-3 space-y-2 text-sm font-mono">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-muted shrink-0 w-16">Email:</span>
                    <span className="text-text break-all">{createdAccount.email}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-muted shrink-0 w-16">Пароль:</span>
                    <span className="text-text break-all">{createdAccount.password}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={copyCredentials}
                    className="btn-secondary flex items-center gap-1.5"
                  >
                    {copyState === 'copied' ? (
                      <>
                        <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Скопировано
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                        </svg>
                        Скопировать данные
                      </>
                    )}
                  </button>
                  <button type="button" className="btn-primary" onClick={closeCreate}>Готово</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Имя</label>
                  <input
                    className="input"
                    value={createForm.full_name}
                    onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="Иванов Иван"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Email *</label>
                  <input
                    type="email"
                    className="input"
                    value={createForm.email}
                    onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="user@company.com"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Пароль *</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input pr-10"
                      value={createForm.password}
                      onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Минимум 6 символов"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text p-1 rounded"
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text mb-1">Роль</label>
                  <select
                    className="input"
                    value={createForm.role}
                    onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                  >
                    <option value="member">Участник</option>
                    <option value="manager">Менеджер</option>
                    <option value="admin">Администратор</option>
                  </select>
                </div>

                {createError && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 break-words">
                    {createError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" className="btn-secondary" onClick={closeCreate}>Отмена</button>
                  <button type="submit" className="btn-primary flex items-center gap-2" disabled={createSaving}>
                    {createSaving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    Создать
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text mb-2">Удалить пользователя?</h2>
            <p className="text-sm text-muted mb-5">
              <span className="text-text font-medium">{confirmDelete.full_name || confirmDelete.email}</span> будет полностью удалён из приложения. Восстановить нельзя.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Отмена
              </button>
              <button
                onClick={() => deleteMember(confirmDelete)}
                disabled={deleting}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
