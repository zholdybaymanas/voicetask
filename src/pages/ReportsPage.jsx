import { useState, useEffect, useMemo, useRef } from 'react'
import { supabaseRest } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const STATUS_LABEL = {
  pending:     'Новая',
  in_progress: 'В работе',
  review:      'На проверке',
  done:        'Выполнена',
}

const PRIORITY_LABEL = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }

function normStatus(s) {
  if (s === 'todo') return 'pending'
  if (s === 'cancelled') return 'done'
  return s ?? 'pending'
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function ReportsPage() {
  const { profile } = useAuth()
  const [tasks, setTasks]       = useState([])
  const [projects, setProjects] = useState([])
  const [team, setTeam]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [exporting, setExporting] = useState(false)

  const [fProject,   setFProject]   = useState('')
  const [fAssignee,  setFAssignee]  = useState('')
  const [fStatus,    setFStatus]    = useState('')
  const [fFrom,      setFFrom]      = useState('')
  const [fTo,        setFTo]        = useState('')

  const reportRef = useRef(null)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [tasksRes, projectsRes, profilesRes] = await Promise.all([
        supabaseRest('tasks', {
          select: '*,projects(name,color)',
          filters: ['order=created_at.desc'],
        }),
        supabaseRest('projects', { select: 'id,name', filters: ['archived=eq.false'] }),
        supabaseRest('profiles', { select: 'id,full_name,email' }),
      ])
      if (tasksRes.error)    throw new Error(tasksRes.error.message    ?? 'Ошибка загрузки задач')
      if (projectsRes.error) throw new Error(projectsRes.error.message ?? 'Ошибка загрузки проектов')
      if (profilesRes.error) throw new Error(profilesRes.error.message ?? 'Ошибка загрузки команды')
      setTasks(tasksRes.data ?? [])
      setProjects(projectsRes.data ?? [])
      setTeam(profilesRes.data ?? [])
    } catch (err) {
      console.error('[ReportsPage] loadAll:', err)
      setError(err.message ?? 'Не удалось загрузить отчёт')
    } finally {
      setLoading(false)
    }
  }

  const teamById = useMemo(() => Object.fromEntries(team.map(u => [u.id, u])), [team])

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (fProject  && t.project_id  !== fProject)  return false
      if (fAssignee && t.assignee_id !== fAssignee) return false
      if (fStatus   && normStatus(t.status) !== fStatus) return false
      if (fFrom && (!t.created_at || t.created_at < fFrom)) return false
      if (fTo) {
        // Inclusive end of day
        const toEnd = fTo + 'T23:59:59'
        if (!t.created_at || t.created_at > toEnd) return false
      }
      return true
    })
  }, [tasks, fProject, fAssignee, fStatus, fFrom, fTo])

  const totals = useMemo(() => {
    const out = { total: filtered.length, pending: 0, in_progress: 0, review: 0, done: 0, overdue: 0 }
    const today = new Date().toISOString().split('T')[0]
    for (const t of filtered) {
      const s = normStatus(t.status)
      if (out[s] != null) out[s] += 1
      if (t.due_date && t.due_date < today && s !== 'done') out.overdue += 1
    }
    return out
  }, [filtered])

  function resetFilters() {
    setFProject(''); setFAssignee(''); setFStatus(''); setFFrom(''); setFTo('')
  }

  async function exportPDF() {
    if (!reportRef.current) return
    setExporting(true)
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ])
      const canvas = await html2canvas(reportRef.current, {
        scale: 1.5,
        backgroundColor: '#ffffff',
        useCORS: true,
      })
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageHeight = pdf.internal.pageSize.getHeight()
      const imgWidth   = pdf.internal.pageSize.getWidth()
      const imgHeight  = (canvas.height * imgWidth) / canvas.width
      const imgData    = canvas.toDataURL('image/png')

      let heightLeft = imgHeight
      let position = 0
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight

      while (heightLeft > 0) {
        position = -(imgHeight - heightLeft)
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
        heightLeft -= pageHeight
      }

      const today = new Date().toISOString().split('T')[0]
      pdf.save(`voicetask-report-${today}.pdf`)
    } catch (err) {
      console.error('[ReportsPage] PDF export:', err)
      alert('Не удалось сформировать PDF: ' + (err.message ?? err))
    } finally {
      setExporting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-muted">{error}</p>
      <button className="btn-secondary text-sm" onClick={loadAll}>Повторить</button>
    </div>
  )

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-muted mb-1">Проект</label>
          <select className="input w-auto text-sm" value={fProject} onChange={e => setFProject(e.target.value)}>
            <option value="">Все</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Исполнитель</label>
          <select className="input w-auto text-sm" value={fAssignee} onChange={e => setFAssignee(e.target.value)}>
            <option value="">Все</option>
            {team.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Статус</label>
          <select className="input w-auto text-sm" value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="">Все</option>
            <option value="pending">Новая</option>
            <option value="in_progress">В работе</option>
            <option value="review">На проверке</option>
            <option value="done">Выполнена</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Создано с</label>
          <input type="date" className="input w-auto text-sm" value={fFrom} onChange={e => setFFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">по</label>
          <input type="date" className="input w-auto text-sm" value={fTo} onChange={e => setFTo(e.target.value)} />
        </div>
        {(fProject || fAssignee || fStatus || fFrom || fTo) && (
          <button className="btn-secondary text-xs px-3 py-1.5" onClick={resetFilters}>Сбросить</button>
        )}
        <div className="flex-1" />
        <button
          className="btn-primary text-sm flex items-center gap-1.5 shrink-0"
          onClick={exportPDF}
          disabled={exporting || filtered.length === 0}
        >
          {exporting ? (
            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          )}
          Экспорт в PDF
        </button>
      </div>

      {/* Captured area — explicit light styling so PDF is consistent across themes */}
      <div ref={reportRef} className="bg-white text-slate-900 rounded-xl border border-slate-200 p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Отчёт по задачам</h2>
          <p className="text-xs text-slate-500 mt-1">
            Сформирован {new Date().toLocaleString('ru-RU', {
              day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
            {profile?.full_name && ` · ${profile.full_name}`}
          </p>
        </div>

        {/* Active filters summary */}
        {(fProject || fAssignee || fStatus || fFrom || fTo) && (
          <div className="text-xs text-slate-600 mb-3 flex flex-wrap gap-x-4 gap-y-1">
            {fProject && <span>Проект: <b>{projects.find(p => p.id === fProject)?.name}</b></span>}
            {fAssignee && <span>Исполнитель: <b>{teamById[fAssignee]?.full_name || teamById[fAssignee]?.email}</b></span>}
            {fStatus && <span>Статус: <b>{STATUS_LABEL[fStatus]}</b></span>}
            {fFrom && <span>С: <b>{fFrom}</b></span>}
            {fTo && <span>По: <b>{fTo}</b></span>}
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mb-4">
          <Totals label="Всего"        value={totals.total}        color="bg-slate-100 text-slate-900" />
          <Totals label="Новые"        value={totals.pending}      color="bg-slate-100 text-slate-700" />
          <Totals label="В работе"     value={totals.in_progress}  color="bg-blue-50 text-blue-700" />
          <Totals label="На проверке"  value={totals.review}       color="bg-violet-50 text-violet-700" />
          <Totals label="Выполнено"    value={totals.done}         color="bg-emerald-50 text-emerald-700" />
          <Totals label="Просрочено"   value={totals.overdue}      color="bg-red-50 text-red-700" />
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">Нет задач по выбранным фильтрам</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Задача</th>
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Проект</th>
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Исполнитель</th>
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Статус</th>
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Приоритет</th>
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Дедлайн</th>
                  <th className="text-left px-3 py-2 font-semibold border-b border-slate-200">Создана</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const status = normStatus(t.status)
                  const assignee = teamById[t.assignee_id]
                  return (
                    <tr key={t.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 font-medium text-slate-900">{t.title}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {t.projects ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.projects.color ?? '#2D5BE3' }} />
                            {t.projects.name}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{assignee?.full_name || assignee?.email || '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{STATUS_LABEL[status]}</td>
                      <td className="px-3 py-2 text-slate-700">{PRIORITY_LABEL[t.priority] ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{fmtDate(t.due_date)}</td>
                      <td className="px-3 py-2 text-slate-500">{fmtDate(t.created_at?.slice(0, 10))}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 text-slate-700 font-semibold">
                  <td className="px-3 py-2" colSpan={6}>Итого: {totals.total} задач, выполнено {totals.done}, просрочено {totals.overdue}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Totals({ label, value, color }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${color}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-xl font-bold leading-none mt-1">{value}</p>
    </div>
  )
}
