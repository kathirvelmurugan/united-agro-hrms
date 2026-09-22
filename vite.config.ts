import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/UA/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/UA/api': {
        target: 'http://localhost:5000',
        rewrite: (path) => path.replace(/^\/UA/, ''),
      },
    },
  },
})
