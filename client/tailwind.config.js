/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
  safelist: [
    // Ensure dynamic classes are included
    'bg-emerald-400/10',
    'bg-emerald-400/20',
    'ring-emerald-400/20',
    'ring-emerald-400/30',
    'bg-black/20',
    'bg-black/25',
    'bg-black/30',
    'bg-black/35',
    'bg-black/40',
    'bg-black/45',
    'bg-black/55',
    'bg-white/5',
    'bg-white/10',
    'bg-white/15',
    'bg-white/60',
    'bg-white/70',
    'bg-white/80',
    'bg-white/90',
    'text-white/60',
    'text-white/70',
    'text-white/80',
    'text-white/90',
    'ring-white/10',
  ],
}
