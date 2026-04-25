/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens — values come from CSS variables on [data-theme]
        primary: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          dark:    'rgb(var(--accent-dark-rgb) / <alpha-value>)',
        },
        bg:      'rgb(var(--bg-rgb) / <alpha-value>)',
        sidebar: 'rgb(var(--sidebar-rgb) / <alpha-value>)',
        card:    'rgb(var(--card-rgb) / <alpha-value>)',
        text:    'rgb(var(--text-rgb) / <alpha-value>)',
        muted:   'rgb(var(--muted-rgb) / <alpha-value>)',
        border:  'rgb(var(--border-rgb) / <alpha-value>)',
        hover:   'rgb(var(--hover-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card':       'var(--shadow)',
        'card-hover': 'var(--shadow-hover)',
        'glow':       'var(--shadow-glow)',
      },
    },
  },
  plugins: [],
}
