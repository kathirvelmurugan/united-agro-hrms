import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/UA/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/UA/api': {
        target: 'https://win.howtostart.in',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'https://win.howtostart.in',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/UA/api'),
      },
    },
  },
})
