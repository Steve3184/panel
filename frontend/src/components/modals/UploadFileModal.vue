<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t('files.upload.title') }} {{ fmStore.currentPath || t('files.root') }}</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div :class="['border border-2 border-dashed rounded p-3 text-center mb-3', { 'border-primary': isDragging }]" @dragenter.prevent="isDragging = true" @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false" @drop.prevent="handleDrop">
            <p class="mb-0 text-muted">{{ t('files.upload.hint1') }}</p>
          </div>
          <input class="form-control" type="file" ref="fileInput" @change="handleFileSelect" multiple>
          <div v-if="uploadStatus.fileName" class="mt-3">
            <p>{{ t('files.upload.uploading') }}: {{ uploadStatus.fileName }}</p>
            <div class="progress">
              <div class="progress-bar" role="progressbar" :style="{ width: uploadStatus.progress + '%' }" :aria-valuenow="uploadStatus.progress">{{ uploadStatus.progress.toFixed(0) }}%</div>
            </div>
            <p class="text-muted small">{{ uploadStatus.message }}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">{{ t('files.upload.done') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, watch } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useFileManagerStore } from '../../stores/fileManager';
import { useI18n } from '../../composables/useI18n';

const uiStore = useUiStore();
const fmStore = useFileManagerStore();
const { t } = useI18n();
const modalEle = ref(null);
const fileInput = ref(null);
let modal = null;

const isDragging = ref(false);
const uploadStatus = reactive({
    fileName: '',
    progress: 0,
    message: ''
});

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('uploadFile');
  });
  // Initial display based on uiStore.modals.uploadFile
  if (uiStore.modals.uploadFile) {
    modal.show();
  }
});
onBeforeUnmount(() => modal?.dispose());

watch(() => uiStore.modals.uploadFile, (isVisible) => {
  if (isVisible) modal.show();
  else modal.hide();
});

const close = () => uiStore.closeModal('uploadFile');

const handleDrop = (e) => {
    isDragging.value = false;
    startUpload(e.dataTransfer.files[0]);
};

const handleFileSelect = (e) => {
    startUpload(e.target.files[0]);
};

const startUpload = async (file) => {
    if (!file || !fmStore.currentInstanceId) return;

    uploadStatus.fileName = file.name;
    uploadStatus.progress = 0;
    uploadStatus.message = t('files.upload.initializing_status');

    const chunkSize = 1 * 1024 * 1024;
    let offset = 0;

    try {
        const initRes = await fetch(`/api/instances/${fmStore.currentInstanceId}/upload/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, fileSize: file.size, targetDirectory: fmStore.currentPath })
        });
        if (!initRes.ok) throw new Error(await initRes.text());
        const { uploadId } = await initRes.json();

        while (offset < file.size) {
            const chunk = file.slice(offset, offset + chunkSize);
            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', Math.floor(offset / chunkSize)); // 添加 chunkIndex
            formData.append('chunk', chunk);
            
            const chunkRes = await fetch(`/api/instances/${fmStore.currentInstanceId}/upload/chunk`, { method: 'POST', body: formData });
            if (!chunkRes.ok) throw new Error(await chunkRes.text());
            
            offset += chunk.size;
            uploadStatus.progress = (offset / file.size) * 100;
            uploadStatus.message = t('files.upload.uploading_status', { uploaded: Math.round(offset / 1024), total: Math.round(file.size / 1024) });
        }

        await fetch(`/api/instances/${fmStore.currentInstanceId}/upload/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId, fileName: file.name, destinationPath: fmStore.currentPath })
        });

        uploadStatus.message = t('files.upload.complete');
        fmStore.loadFiles(fmStore.currentPath); // Refresh file list
    } catch (error) {
        uploadStatus.message = `${t('error.title')}: ${error.message}`;
        uiStore.showToast(uploadStatus.message, 'danger');
    } finally {
        fileInput.value.value = ''; // Reset file input
    }
};
</script>