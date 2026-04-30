import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseRest, supabasePatch, supabaseDelete, getCurrentUser, getAuthHeader } from '../lib/supabase'
import { taskVisibilityFilter } from '../lib/taskAccess'
import { useAuth } from '../hooks/useAuth'

const COLORS = ['#2D5BE3', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B']

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [projects, setProjects]     = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [doneCounts, setDoneCounts] = useState({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editingId, setEditingId]   = useState(null) // null = create mode, uuid = edit mode
  const [form, setForm]             = useState({ name: '', description: '', color: COLORS[0] })
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting]     = useState(false)

  // Project members modal — admin only. We load all profiles once and
  // the current member set per opened project.
  const [membersModalProject, setMembersModalProject] = useState(null)
  const [allProfiles, setAllProfiles]   = useState([])
  const [memberIds,   setMemberIds]     = useState(new Set())
  const [membersSaving, setMembersSaving] = useState(false)
  const [membersError,  setMembersError]  = useState('')

  const isAdmin = profile?.role === 'admin'

  useEffect(() => { loadProjects() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id, profile?.role])

  async function loadProjects() {
    setLoading(true)
    setError(null)
    try {
      const [projectsRes, tasksRes] = await Promise.all([
        supabaseRest('projects', { filters: ['archived=eq.false', 'order=created_at.asc'] }),
        supabaseRest('tasks', { select: 'project_id,status', filters: taskVisibilityFilter(user, profile) }),
      ])
      if (projectsRes.error) throw new Error(projectsRes.error.message ?? JSON.stringify(projectsRes.error))
      if (tasksRes.error)    throw new Error(tasksRes.error.message    ?? JSON.stringify(tasksRes.error))
      setProjects(projectsRes.data ?? [])
      const counts = {}, done = {}
      for (const t of tasksRes.data ?? []) {
        if (!t.project_id) continue
        counts[t.project_id] = (counts[t.project_id] ?? 0) + 1
        if (t.status === 'done') done[t.project_id] = (done[t.project_id] ?? 0) + 1
      }
      setTaskCounts(counts)
      setDoneCounts(done)
    } catch (err) {
      console.error('[ProjectsPage] loadProjects:', err)
      setError(err.message ?? 'Не удалось загрузить проекты')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingId(null)
    setForm({ name: '', description: '', color: COLORS[0] })
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(project) {
    setEditingId(project.id)
    setForm({
      name:        project.name ?? '',
      description: project.description ?? '',
      color:       project.color ?? COLORS[0],
    })
    setFormError('')
    setModalOpen(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Введите название проекта')

    const user = getCurrentUser()
    if (!user?.id) {
      setFormError('Сессия не найдена. Войдите заново.')
      return
    }

    setSaving(true)
    const body = {
      name:        form.name.trim(),
      description: form.description.trim() || null,
      color:       form.color,
    }

    let result
    if (editingId) {
      result = await supabasePatch('projects', editingId, body)
    } else {
      result = await supabaseRest('projects', { method: 'POST', body: { ...body, owner_id: user.id } })
    }
    setSaving(false)

    if (result.error) {
      console.error('[ProjectsPage] save error:', result.error, '| sent:', body)
      const msg = result.error.message ?? result.error.hint ?? JSON.stringify(result.error)
      return setFormError(`Ошибка: ${msg}`)
    }

    setModalOpen(false)
    setEditingId(null)
    setForm({ name: '', description: '', color: COLORS[0] })
    loadProjects()
  }

  async function openMembers(project) {
    setMembersModalProject(project)
    setMembersError('')
    setMembersSaving(false)
    // Load profiles + current membership in parallel.
    const [profilesRes, membersRes] = await Promise.all([
      allProfiles.length > 0
        ? Promise.resolve({ data: allProfiles, error: null })
        : supabaseRest('profiles', { select: 'id,full_name,email,role', filters: ['order=full_name.asc.nullslast,email.asc'] }),
      supabaseRest('project_members', { select: 'user_id', filters: [`project_id=eq.${project.id}`] }),
    ])
    if (profilesRes.error) {
      setMembersError(profilesRes.error.message ?? 'Не удалось загрузить участников')
      return
    }
    if (allProfiles.length === 0) setAllProfiles(profilesRes.data ?? [])
    setMemberIds(new Set((membersRes.data ?? []).map(r => r.user_id)))
  }

  function toggleMember(userId) {
    setMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  async function saveMembers() {
    if (!membersModalProject) return
    setMembersSaving(true)
    setMembersError('')
    try {
      const authHeaders = await getAuthHeader()
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          action:     'updateProjectMembers',
          project_id: membersModalProject.id,
          user_ids:   [...memberIds],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
      setMembersModalProject(null)
    } catch (err) {
      console.error('[ProjectsPage] saveMembers:', err)
      setMembersError(err.message)
    } finally {
      setMembersSaving(false)
    }
  }

  async function deleteProject(id) {
    setDeleting(true)
    const { error } = await supabaseDelete('projects', id)
    setDeleting(false)
    setConfirmDeleteId(null)
    if (error) {
      console.error('[ProjectsPage] delete error:', error)
      setError(error.message ?? 'Не удалось удалить проект')
      return
    }
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const projectToDelete = projects.find(p => p.id === confirmDeleteId) ?? null

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-muted">{error}</p>
      <button className="btn-secondary text-sm" onClick={loadProjects}>Повторить</button>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{projects.length} проектов</p>
        <button
          className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
          onClick={openCreate}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="hidden sm:inline">Создать проект</span>
          <span className="sm:hidden">Создать</span>
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-card flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-text">Проектов пока нет</p>
          <p className="text-xs text-muted mt-1">Создайте первый проект</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {projects.map(p => {
            const total    = taskCounts[p.id] ?? 0
            const done     = doneCounts[p.id] ?? 0
            const progress = total > 0 ? Math.round((done / total) * 100) : 0
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                className="bg-card rounded-xl border border-border shadow-card hover:shadow-card-hover transition-shadow overflow-hidden group cursor-pointer"
              >
                <div className="h-1.5" style={{ backgroundColor: p.color ?? '#2D5BE3' }} />

                <div className="p-4">
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text truncate">{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-muted mt-0.5 line-clamp-2">{p.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {isAdmin && (
                        <button
                          onClick={e => { e.stopPropagation(); openMembers(p) }}
                          title="Участники проекта"
                          className="text-muted hover:text-text p-1 rounded"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round"
                              d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); openEdit(p) }}
                        title="Редактировать проект"
                        className="text-muted hover:text-text p-1 rounded"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(p.id) }}
                        title="Удалить проект"
                        className="text-muted hover:text-red-500 p-1 rounded"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{total} задач</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-hover rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${progress}%`, backgroundColor: p.color ?? '#2D5BE3' }}
                      />
                    </div>
                    <p className="text-xs text-muted">{done} из {total} выполнено</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setConfirmDeleteId(null)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text mb-2">Удалить проект?</h2>
            <p className="text-sm text-muted mb-5">
              Проект <span className="text-text font-medium">«{projectToDelete.name}»</span> будет удалён без возможности восстановления.
              Связанные задачи останутся, но потеряют ссылку на проект.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
              >
                Отмена
              </button>
              <button
                onClick={() => deleteProject(projectToDelete.id)}
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text">{editingId ? 'Редактировать проект' : 'Новый проект'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text mb-1">Название *</label>
                <input className="input" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Название проекта" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Описание</label>
                <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Необязательно" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-2">Цвет</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c} type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-offset-card ring-text scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {formError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 break-words">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Отмена</button>
                <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {editingId ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Project members modal — admin only. Replaces the project's
          membership set in one shot via /api/admin updateProjectMembers. */}
      {membersModalProject && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !membersSaving && setMembersModalProject(null)} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-text">Участники проекта</h2>
              <button onClick={() => !membersSaving && setMembersModalProject(null)} className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-muted mb-4 truncate">«{membersModalProject.name}»</p>

            <div className="max-h-72 overflow-y-auto -mx-2 mb-4 rounded-lg border border-border divide-y divide-border">
              {allProfiles.length === 0 ? (
                <p className="text-sm text-muted px-3 py-4">Загрузка…</p>
              ) : (
                allProfiles.map(u => {
                  const checked = memberIds.has(u.id)
                  const userIsAdmin = u.role === 'admin'
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 px-3 py-2 hover:bg-hover cursor-pointer ${userIsAdmin ? 'opacity-70' : ''}`}
                      title={userIsAdmin ? 'Администраторы видят все проекты автоматически' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked || userIsAdmin}
                        onChange={() => !userIsAdmin && toggleMember(u.id)}
                        disabled={userIsAdmin}
                        className="accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text truncate">{u.full_name || u.email}</p>
                        {u.full_name && <p className="text-xs text-muted truncate">{u.email}</p>}
                      </div>
                      {userIsAdmin && (
                        <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0">
                          admin
                        </span>
                      )}
                    </label>
                  )
                })
              )}
            </div>

            {membersError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3 break-words">
                {membersError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={membersSaving} onClick={() => setMembersModalProject(null)}>
                Отмена
              </button>
              <button type="button" className="btn-primary flex items-center gap-2" disabled={membersSaving} onClick={saveMembers}>
                {membersSaving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
