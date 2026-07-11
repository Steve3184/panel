import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monacoEditorPlugin from 'vite-plugin-monaco-editor-esm';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monacoEditorPlugin({
      // esbuild 0.28 no longer resolves these package-export paths without .js.
      languageWorkers: [],
      customWorkers: [
        { label: 'editorWorkerService', entry: 'monaco-editor/esm/vs/editor/editor.worker.js' },
        { label: 'json', entry: 'monaco-editor/esm/vs/language/json/json.worker.js' },
        { label: 'html', entry: 'monaco-editor/esm/vs/language/html/html.worker.js' },
      ],
    })
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
