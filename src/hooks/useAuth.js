import { useState, useEffect } from 'react'
import { supabase, supabaseRest } from '../lib/supabase'

// Where Supabase sends confirmation / reset links back to. Prefer the
// build-time VITE_APP_URL (set per environment in Vercel / .env), fall
// back to whichever origin the user is signing up from. This avoids
// localhost links being sent to coworkers in production.
function getRedirectURL() {
  const fromEnv = import.meta.env.VITE_APP_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return undefined
}

// Read session from localStorage without touching the Supabase client
function readStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }
    }
  } catch {}
  return null
}

export function useAuth() {
  // Initialize immediately from localStorage — no waiting for getSession() which may hang
  const [session, setSession] = useState(() => readStoredSession())
  const [user, setUser]       = useState(() => readStoredSession()?.user ?? null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    // Load profile for users already logged in at mount time
    const stored = readStoredSession()
    if (stored?.user) loadProfile(stored.user.id)

    // Handle future auth changes: sign-in, sign-out, token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await supabaseRest('profiles', { filters: [`id=eq.${userId}`] })
    setProfile(data?.[0] ?? null)
  }

  async function signIn(email, password) {
    setError(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    return { data, error }
  }

  async function signUp(email, password, fullName) {
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName?.trim() || '' },
        emailRedirectTo: getRedirectURL(),
      },
    })
    if (error) setError(error.message)
    return { data, error }
  }

  async function resetPassword(email) {
    setError(null)
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getRedirectURL(),
    })
    if (error) setError(error.message)
    return { data, error }
  }

  function signOut() {
    // Instant UX: wipe local auth state synchronously so ProtectedRoute
    // re-renders and redirects to /auth on the very next React commit,
    // then revoke the refresh token in the background. We don't await
    // Supabase — a slow network or expired token shouldn't block the user
    // from leaving the app.
    setError(null)
    setUser(null)
    setSession(null)
    setProfile(null)
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
          localStorage.removeItem(key)
        }
      }
    } catch {}
    supabase.auth.signOut().catch(err => {
      console.warn('[useAuth] background signOut failed:', err)
    })
    return { error: null }
  }

  return { session, user, profile, loading, error, signIn, signUp, signOut, resetPassword }
}
