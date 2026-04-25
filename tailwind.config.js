/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2D5BE3',
          light: '#5579E8',
          dark: '#1E3FB0',
          50:  '#EEF2FC',
          100: '#D6DFFA',
          200: '#ADC0F5',
          300: '#84A0F0',
          400: '#5B81EB',
          500: '#2D5BE3',
          600: '#2449B6',
          700: '#1B3789',
          800: '#12245C',
          900: '#09122E',
        },
        gray: {
          50:  '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 12px 0 rgb(45 91 227 / 0.12)',
      },
    },
  },
  plugins: [],
}
