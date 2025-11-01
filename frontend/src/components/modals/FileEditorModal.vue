<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Editing: <span class="text-info">{{ filePath }}</span></h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body p-0">
          <div ref="editorContainerEle" style="height: calc(100vh - 180px);"></div>
        </div>
        <div class="modal-footer">
          <span class="me-auto text-muted">{{ status }}</span>
          <button type="button" class="btn btn-secondary" @click="close">Close</button>
          <button type="button" class="btn btn-primary" @click="saveContent(false)" :disabled="isSaving">Save</button>
           <button type="button" class="btn btn-success" @click="saveContent(true)" :disabled="isSaving">Save & Close</button>
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

const status = ref('Connecting...');
const isSaving = ref(false);

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value, { backdrop: 'static', keyboard: false });
  modalEle.value.addEventListener('hidden.bs.modal', cleanup);
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
    status.value = "Loading file...";

    try {
        const { content } = await api.getFileContent(props.instanceId, props.filePath);
        editor = monaco.editor.create(editorContainerEle.value, {
            value: content,
            language: getLanguageFromPath(props.filePath),
            theme: 'vs-dark',
            automaticLayout: true,
        });
        status.value = "File loaded.";
        setupWebSocket();
    } catch(error) {
        status.value = `Error: ${error.message}`;
        uiStore.showToast(status.value, 'danger');
    }
};

const setupWebSocket = () => {
    ws = websocketStore.getSocket();
    if (!ws) {
        status.value = "WebSocket not connected.";
        return;
    }
    // No need to add a new listener, just send subscribe message
    websocketStore.sendMessage({
        type: 'subscribe-file-edit',
        instanceId: props.instanceId,
        filePath: props.filePath
    });
    status.value = "Connected.";
};

const saveContent = (closeAfterSave = false) => {
    if (!editor || !ws) return;
    isSaving.value = true;
    status.value = "Saving...";
    websocketStore.sendMessage({
        type: 'save-file',
        instanceId: props.instanceId,
        filePath: props.filePath,
        content: editor.getValue(),
        closeEditor: closeAfterSave
    });
    // Assuming backend sends a confirmation message
    // For now, we'll just update status and potentially close
    setTimeout(() => { // Simulate save confirmation
        status.value = "Saved.";
        isSaving.value = false;
        if(closeAfterSave) close();
    }, 1000);
};

const getLanguageFromPath = (path) => {
    const ext = path.split('.').pop().toLowerCase();
    // Simplified mapping
    const map = { js: 'javascript', ts: 'typescript', json: 'json', html: 'html', css: 'css', md: 'markdown', py: 'python', java: 'java' };
    return map[ext] || 'plaintext';
};

const cleanup = () => {
    if (ws) {
        websocketStore.sendMessage({ type: 'unsubscribe-file-edit', instanceId: props.instanceId, filePath: props.filePath });
    }
    editor?.dispose();
    editor = null;
    ws = null;
};

const close = () => uiStore.closeModal('fileEditor');
</script>