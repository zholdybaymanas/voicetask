import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase, supabaseRest } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import VoiceInput from './VoiceInput'

const NAV = [
  {
    path: '/', end: true, label: 'Главная',
    // Home icon
    icon: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  },
  {
    path: '/tasks', label: 'Задачи',
    icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
  },
  {
    path: '/projects', label: 'Проекты',
    icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z',
  },
  {
    path: '/team', label: 'Команда',
    icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  },
  {
    path: '/notifications', label: 'Уведомления',
    icon: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  },
  {
    path: '/reports', label: 'Отчёты',
    icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  },
]

const PAGE_TITLES = {
  '/': 'Главная',
  '/tasks': 'Задачи', '/projects': 'Проекты', '/team': 'Команда',
  '/reports': 'Отчёты', '/notifications': 'Уведомления',
}

function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme()
  return (
    <div className="flex items-center gap-1.5">
      {themes.map(t => {
        const active = t.id === theme
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            title={t.name}
            aria-label={`Тема ${t.name}`}
            className={`group relative w-5 h-5 rounded-full transition-transform hover:scale-110 ${active ? 'scale-110' : ''}`}
            style={{
              background: t.swatch,
              border: `1.5px solid ${active ? t.accent : t.borderColor}`,
              boxShadow: active ? `0 0 0 2px rgb(var(--bg-rgb)), 0 0 0 3.5px ${t.accent}` : 'none',
            }}
          >
            <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-card border border-border text-text text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-card z-50">
              {t.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function Layout() {
  const { user, profile, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  )
  const [unread, setUnread] = useState(0)
  const location = useLocation()

  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!user) return
    fetchUnread()
    const channel = supabase.channel('layout-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, fetchUnread)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user])

  async function fetchUnread() {
    const { data } = await supabaseRest('notifications', {
      select: 'id',
      filters: [`user_id=eq.${user.id}`, 'read=eq.false'],
    })
    setUnread(data?.length ?? 0)
  }

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'Пользователь'
  const initials = displayName[0].toUpperCase()
  const pageTitle = PAGE_TITLES[location.pathname] ?? 'VoiceTask'

  return (
    <div className="min-h-screen bg-bg flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-40
          w-60 bg-sidebar border-r border-border
          flex flex-col shrink-0
          transition-transform duration-200 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:-ml-60'}
        `}
      >
        <div className="flex items-center gap-2.5 h-14 px-5 border-b border-border">
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
          <span className="font-semibold text-text text-sm tracking-tight">VoiceTask</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto md:hidden text-muted hover:text-text p-1 rounded"
            aria-label="Закрыть меню"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ path, end, label, icon }) => (
            <NavLink
              key={path}
              to={path}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-100 ${
                  isActive
                    ? 'nav-active'
                    : 'text-muted hover:bg-hover hover:text-text'
                }`
              }
            >
              <svg className="w-[18px] h-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
              <span className="truncate">{label}</span>
              {path === '/notifications' && unread > 0 && (
                <span className="ml-auto text-[10px] font-semibold bg-primary text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-4">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 pb-4 pt-2 border-t border-border">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-hover transition-colors group">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text truncate">{displayName}</p>
              {profile?.full_name && (
                <p className="text-[11px] text-muted truncate">{user?.email}</p>
              )}
            </div>
            <button
              onClick={signOut}
              title="Выйти"
              className="md:opacity-0 md:group-hover:opacity-100 transition-opacity text-muted hover:text-text p-1 rounded"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-card border-b border-border px-4 sm:px-6 flex items-center gap-3 sm:gap-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="text-muted hover:text-text transition-colors p-1 rounded-md hover:bg-hover"
            aria-label="Меню"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h1 className="text-[15px] font-semibold text-text truncate">{pageTitle}</h1>
          <div className="flex-1" />
          <ThemeSwitcher />
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 sm:pb-6 bg-bg">
          <Outlet />
        </div>
      </main>

      <VoiceInput />
    </div>
  )
}
