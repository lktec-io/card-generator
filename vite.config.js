import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:8803',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      // xlsx is an optional dynamic import — not installed by default.
      // The import() call in ImportPage.jsx catches the failure and shows
      // a "convert to CSV" message. Marking external prevents the build error.
      external: ['xlsx', 'canvas-confetti'],
    },
  },
});
