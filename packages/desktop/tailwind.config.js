/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{html,ts,tsx,js,jsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-dark': '#1e1e1e',
        'bg-sidebar': '#252526',
        'bg-panel': '#2d2d2d',
        'bg-hover': '#3c3c3c',
        'bg-selected': '#094771',
        'border': '#3c3c3c',
        'accent': '#0078d4',
        'accent-hover': '#1c8ae6',
      },
    },
  },
  plugins: [],
}
