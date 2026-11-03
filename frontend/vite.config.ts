import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Keep the browser on one origin while FastAPI serves /api on port 8000.
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
