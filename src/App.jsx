import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ThemeProvider } from './contexts/ThemeContext'
import AuthPage from './pages/AuthPage'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import KanbanPage from './pages/KanbanPage'
import TasksPage from './pages/TasksPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import TeamPage from './pages/TeamPage'
import NotificationsPage from './pages/NotificationsPage'
import ReportsPage from './pages/ReportsPage'

const Spinner = () => (
  <div className="min-h-screen bg-bg flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
)

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/auth" replace />
  return <Outlet />
}

function PublicRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicRoute />}>
            <Route path="/auth" element={<AuthPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/"              element={<Dashboard />} />
              <Route path="/dashboard"     element={<Dashboard />} />
              <Route path="/kanban"        element={<KanbanPage />} />
              <Route path="/tasks"         element={<TasksPage />} />
              <Route path="/projects"      element={<ProjectsPage />} />
              <Route path="/projects/:id"  element={<ProjectDetailPage />} />
              <Route path="/team"          element={<TeamPage />} />
              <Route path="/reports"       element={<ReportsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
