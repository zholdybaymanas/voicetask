import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function AuthPage() {
  const { signIn, signUp, error } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [info, setInfo] = useState('')

  function switchMode(next) {
    setMode(next)
    setFormError('')
    setInfo('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError('')
    setInfo('')

    if (!email.trim()) return setFormError('Введите email')
    if (!password) return setFormError('Введите пароль')

    if (mode === 'signup') {
      if (password.length < 6) return setFormError('Пароль минимум 6 символов')
      if (!fullName.trim()) return setFormError('Введите имя')
    }

    setLoading(true)
    const { data, error } = mode === 'signin'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password, fullName)
    setLoading(false)

    if (error) {
      const msg = error?.message ?? String(error)
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        return setFormError('Неверный email или пароль')
      }
      if (msg.includes('Email not confirmed')) {
        return setFormError('Email не подтверждён — проверьте почту')
      }
      if (msg.includes('User already registered') || msg.includes('already_registered')) {
        return setFormError('Пользователь с таким email уже существует. Войдите.')
      }
      if (msg.includes('Password should be')) {
        return setFormError('Пароль слишком простой — минимум 6 символов')
      }
      return setFormError(msg)
    }

    // Sign-up success without an immediate session means email confirmation is required
    if (mode === 'signup' && data?.user && !data?.session) {
      setInfo(`Регистрация успешна. Подтвердите email (${email}) — мы отправили письмо со ссылкой.`)
      setPassword('')
    }
    // If signUp returned a session, App.jsx ProtectedRoute will navigate automatically
  }

  const displayError = formError || error
  const isSignUp = mode === 'signup'

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-2xl mb-4 fab-accent">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-text">VoiceTask</h1>
          <p className="text-sm text-muted mt-1">Голосовое управление задачами</p>
        </div>

        <div className="card">
          {/* Tab switcher */}
          <div className="flex bg-hover rounded-lg p-1 mb-5">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${
                !isSignUp ? 'bg-card text-text shadow-card' : 'text-muted hover:text-text'
              }`}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${
                isSignUp ? 'bg-card text-text shadow-card' : 'text-muted hover:text-text'
              }`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-sm font-medium text-text mb-1">Имя</label>
                <input
                  className="input"
                  placeholder="Иван Иванов"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                  disabled={loading}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text mb-1">Email</label>
              <input
                type="email"
                className="input"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus={!isSignUp}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-1">Пароль</label>
              <input
                type="password"
                className="input"
                placeholder={isSignUp ? 'Минимум 6 символов' : '••••••••'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                disabled={loading}
              />
            </div>

            {info && (
              <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm rounded-lg px-3 py-2">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                <span>{info}</span>
              </div>
            )}

            {displayError && !info && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-3 py-2">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
                </svg>
                <span className="break-words">{displayError}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isSignUp ? 'Регистрация...' : 'Вход...'}
                </>
              ) : (isSignUp ? 'Создать аккаунт' : 'Войти')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          {isSignUp
            ? 'Уже есть аккаунт? '
            : 'Нет аккаунта? '}
          <button
            type="button"
            onClick={() => switchMode(isSignUp ? 'signin' : 'signup')}
            className="text-primary hover:underline font-medium"
          >
            {isSignUp ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </p>
      </div>
    </div>
  )
}
