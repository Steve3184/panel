<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ $t('files.editor.editing') }} <span class="text-info">{{ filePath }}</span></h5>
          <button type="button" class="btn-close" @click="close" :aria-label="$t('files.editor.close')"></button>
        </div>
        <div class="modal-body p-0">
          <div ref="editorContainerEle" style="height: calc(100vh - 180px);"></div>
        </div>
        <div class="modal-footer">
          <span class="me-auto text-muted">{{ status }}</span>
          <button type="button" class="btn btn-secondary" @click="close">{{ $t('files.editor.close') }}</button>
          <button type="button" class="btn btn-primary" @click="saveContent(false)" :disabled="isSaving">{{
            $t('files.editor.save') }}</button>
          <button type="button" class="btn btn-success" @click="saveContent(true)" :disabled="isSaving">{{
            $t('files.editor.save_and_close') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as bootstrap from 'bootstrap';
import * as monaco from 'monaco-editor';
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
let modal = null;
let editor = null;
let ws = null;
let autoSaveTimer = null;

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
  if (editor) editor.dispose();
  status.value = t('files.editor.status.loading_file');

  try {
    const { content } = await api.getFileContent(props.instanceId, props.filePath);
    editor = monaco.editor.create(editorContainerEle.value, {
      value: content,
      language: getLanguageFromPath(props.filePath),
      theme: 'vs-dark',
      automaticLayout: true,
    });
    status.value = t('files.editor.status.file_loaded');
    setupWebSocket();
    setupEditorListeners();
  } catch (error) {
    status.value = t('files.editor.status.error', { message: error.message });
    uiStore.showToast(status.value, 'danger');
  }
};

const setupEditorListeners = () => {
  if (!editor) return;

  editor.onDidChangeModelContent(() => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      saveContent(false);
    }, 5000); // 5 seconds after last edit
  });

  window.addEventListener('keydown', handleKeyDown);
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
    content: editor.getValue(),
    closeEditor: closeAfterSave
  });
};

const getLanguageFromPath = (path) => {
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
  };
  return map[ext] || 'plaintext';
};

const cleanup = () => {
  if (ws) {
    websocketStore.sendMessage({ type: 'unsubscribe-file-edit', instanceId: props.instanceId, filePath: props.filePath });
  }
  websocketStore.offMessage('file-saved-notification', handleFileSavedNotification);
  clearTimeout(autoSaveTimer);
  window.removeEventListener('keydown', handleKeyDown);
  editor?.dispose();
  editor = null;
  ws = null;
};

const close = () => uiStore.closeModal('fileEditor');
</script>