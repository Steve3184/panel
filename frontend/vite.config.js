import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monacoEditorPlugin()
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    }
  }
})
