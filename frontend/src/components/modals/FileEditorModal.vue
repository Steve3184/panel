<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-fullscreen">
      <div class="modal-content bg-dark text-light border-0">
        <div class="modal-header border-secondary">
          <h5 class="modal-title">{{ $t('files.editor.editing') }} <span class="text-info">{{ filePath }}</span></h5>
          <button type="button" class="btn-close btn-close-white" @click="close" :aria-label="$t('files.editor.close')"></button>
        </div>
        <div class="modal-body p-0 overflow-hidden">
          <div ref="editorContainerEle" class="h-100 w-100"></div>
        </div>
        <div class="modal-footer border-secondary">
          <span class="me-auto text-muted small">{{ status }}</span>
          
          <div class="dropdown me-2">
            <button class="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
              <i class="bi" :class="preferredEditor === 'monaco' ? 'bi-code-square' : 'bi-textarea-t'"></i>
              <span class="ms-1 d-none d-sm-inline">{{ preferredEditor === 'monaco' ? 'Monaco' : 'CodeMirror' }}</span>
            </button>
            <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end">
              <li><h6 class="dropdown-header">{{ $t('files.editor.select_editor') }}</h6></li>
              <li>
                <a class="dropdown-item" href="#" @click.prevent="switchEditor('monaco')" :class="{ active: preferredEditor === 'monaco' }">
                  <i class="bi bi-code-square me-2"></i>{{ $t('files.editor.monaco') }}
                </a>
              </li>
              <li>
                <a class="dropdown-item" href="#" @click.prevent="switchEditor('codemirror')" :class="{ active: preferredEditor === 'codemirror' }">
                  <i class="bi bi-textarea-t me-2"></i>{{ $t('files.editor.codemirror') }}
                </a>
              </li>
            </ul>
          </div>

          <button type="button" class="btn btn-secondary btn-sm" @click="close">{{ $t('files.editor.close') }}</button>
          <button type="button" class="btn btn-primary btn-sm" @click="saveContent(false)" :disabled="isSaving">
            <i class="bi bi-save me-1"></i>{{ $t('files.editor.save') }}
          </button>
          <button type="button" class="btn btn-success btn-sm" @click="saveContent(true)" :disabled="isSaving">
            <i class="bi bi-check-all me-1"></i>{{ $t('files.editor.save_and_close') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useWebSocketStore } from '../../stores/websocket';
import api from '../../services/api';
import { useI18n } from '../../composables/useI18n';

const props = defineProps({
  instanceId: { type: String, required: true },
  filePath: { type: String, required: true },
});

const uiStore = useUiStore();
const websocketStore = useWebSocketStore();
const modalEle = ref(null);
const editorContainerEle = ref(null);
const preferredEditor = ref(localStorage.getItem('preferredEditor') || 'monaco');

let modal = null;
let editor = null; // Monaco editor instance or CodeMirror EditorView
let ws = null;
let autoSaveTimer = null;
let currentFileContent = '';

const { t } = useI18n();
const status = ref(t('files.editor.status.connecting'));
const isSaving = ref(false);

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value, { backdrop: 'static', keyboard: false });
  modalEle.value.addEventListener('hidden.bs.modal', cleanup);
  if (uiStore.modals.fileEditor) {
    modal.show();
    initializeEditor();
  }
});

onBeforeUnmount(() => {
  cleanup();
  modal?.dispose();
});

watch(() => uiStore.modals.fileEditor, async (isVisible) => {
  if (isVisible) {
    modal.show();
    await nextTick();
    await initializeEditor();
  } else {
    modal.hide();
  }
});

const initializeEditor = async () => {
  if (editor) disposeEditor();
  status.value = t('files.editor.status.loading_file');

  try {
    const { content } = await api.getFileContent(props.instanceId, props.filePath);
    currentFileContent = content;
    
    if (preferredEditor.value === 'monaco') {
      await initializeMonaco(content);
    } else {
      await initializeCodeMirror(content);
    }

    status.value = t('files.editor.status.file_loaded');
    setupWebSocket();
    window.addEventListener('keydown', handleKeyDown);
  } catch (error) {
    status.value = t('files.editor.status.error', { message: error.message });
    uiStore.showToast(status.value, 'danger');
  }
};

const initializeMonaco = async (content) => {
  const monaco = await import('monaco-editor');
  editor = monaco.editor.create(editorContainerEle.value, {
    value: content,
    language: getMonacoLanguage(props.filePath),
    theme: 'vs-dark',
    automaticLayout: true,
    tabSize: 2,
    scrollBeyondLastLine: false,
    minimap: { enabled: false }
  });

  editor.onDidChangeModelContent(() => {
    onContentChange();
  });
};

const initializeCodeMirror = async (content) => {
  const { EditorView, basicSetup } = await import('codemirror');
  const { EditorState } = await import('@codemirror/state');
  const { oneDark } = await import('@codemirror/theme-one-dark');
  const { keymap } = await import('@codemirror/view');
  const { indentWithTab } = await import('@codemirror/commands');
  
  const languageSupport = await getCodeMirrorLanguage(props.filePath);
  
  const extensions = [
    basicSetup,
    oneDark,
    keymap.of([indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onContentChange();
      }
    }),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" }
    })
  ];
  
  if (languageSupport) extensions.push(languageSupport);

  editor = new EditorView({
    state: EditorState.create({
      doc: content,
      extensions: extensions,
    }),
    parent: editorContainerEle.value,
  });
};

const disposeEditor = () => {
  if (!editor) return;
  if (typeof editor.dispose === 'function') {
    editor.dispose();
  } else if (typeof editor.destroy === 'function') {
    editor.destroy();
  }
  editor = null;
};

const onContentChange = () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveContent(false);
  }, 10000); // 10 seconds for auto-save
};

const switchEditor = async (type) => {
  if (preferredEditor.value === type) return;
  
  const content = getEditorValue();
  disposeEditor();
  preferredEditor.value = type;
  localStorage.setItem('preferredEditor', type);
  if (type === 'monaco') {
    await initializeMonaco(content);
  } else {
    await initializeCodeMirror(content);
  }
};

const getEditorValue = () => {
  if (!editor) return '';
  if (preferredEditor.value === 'monaco') {
    return editor.getValue();
  } else {
    return editor.state.doc.toString();
  }
};

const handleKeyDown = (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    saveContent(false);
  }
};

const handleFileSavedNotification = (message) => {
  if (message.filePath === props.filePath) {
    status.value = t('files.editor.status.saved');
    isSaving.value = false;
    if (message.closeEditor) {
      close();
    }
  }
};

const setupWebSocket = () => {
  ws = websocketStore.getSocket();
  if (!ws) {
    status.value = t('files.editor.status.ws_not_connected');
    return;
  }
  websocketStore.sendMessage({
    type: 'subscribe-file-edit',
    instanceId: props.instanceId,
    filePath: props.filePath
  });

  websocketStore.onMessage('file-saved-notification', handleFileSavedNotification);
  status.value = t('files.editor.status.connected');
};

const saveContent = (closeAfterSave = false) => {
  if (!editor || !ws) return;
  isSaving.value = true;
  status.value = t('files.editor.status.saving');
  websocketStore.sendMessage({
    type: 'save-file',
    instanceId: props.instanceId,
    filePath: props.filePath,
    content: getEditorValue(),
    closeEditor: closeAfterSave
  });
};

const getMonacoLanguage = (path) => {
  const ext = path.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    py: 'python',
    java: 'java',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    config: 'ini',
    sh: 'shell',
    bash: 'shell',
    rs: 'rust'
  };
  return map[ext] || 'plaintext';
};

const getCodeMirrorLanguage = async (path) => {
  const ext = path.split('.').pop().toLowerCase();
  try {
    switch (ext) {
      case 'js': case 'ts': return (await import('@codemirror/lang-javascript')).javascript();
      case 'json': return (await import('@codemirror/lang-json')).json();
      case 'html': return (await import('@codemirror/lang-html')).html();
      case 'css': return (await import('@codemirror/lang-css')).css();
      case 'md': return (await import('@codemirror/lang-markdown')).markdown();
      case 'py': return (await import('@codemirror/lang-python')).python();
      case 'java': return (await import('@codemirror/lang-java')).java();
      case 'yaml': case 'yml': return (await import('@codemirror/lang-yaml')).yaml();
      case 'rs': return (await import('@codemirror/lang-rust')).rust();
      default: return null;
    }
  } catch (e) {
    console.error('Failed to load CM language support', e);
    return null;
  }
};

const cleanup = () => {
  if (ws) {
    websocketStore.sendMessage({ type: 'unsubscribe-file-edit', instanceId: props.instanceId, filePath: props.filePath });
  }
  websocketStore.offMessage('file-saved-notification', handleFileSavedNotification);
  clearTimeout(autoSaveTimer);
  window.removeEventListener('keydown', handleKeyDown);
  disposeEditor();
  ws = null;
};

const close = () => uiStore.closeModal('fileEditor');
</script>

<style scoped>
.modal-fullscreen .modal-body {
  height: calc(100vh - 110px);
}
:deep(.cm-editor) {
  height: 100%;
  font-size: 0.85rem;
}
:deep(.cm-scroller) {
  font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
}
</style>
