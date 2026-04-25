import { createContext, useContext, useEffect, useState } from 'react'

export const THEMES = [
  { id: 'light',    name: 'Light',    swatch: '#FFFFFF', accent: '#2D5BE3', borderColor: '#E9E9E7' },
  { id: 'dark',     name: 'Dark',     swatch: '#0A0A0A', accent: '#2D5BE3', borderColor: '#222222' },
  { id: 'midnight', name: 'Midnight', swatch: '#060610', accent: '#7C3AED', borderColor: '#1A1A3E' },
  { id: 'forest',   name: 'Forest',   swatch: '#0D1117', accent: '#10B981', borderColor: '#30363D' },
]

const STORAGE_KEY = 'voicetask:theme'
const DEFAULT_THEME = 'light'

const ThemeContext = createContext(null)

function readStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return THEMES.some(t => t.id === v) ? v : DEFAULT_THEME
  } catch { return DEFAULT_THEME }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  function setTheme(id) {
    if (THEMES.some(t => t.id === id)) setThemeState(id)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
