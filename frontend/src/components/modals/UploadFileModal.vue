<template>
  <div class="modal fade" data-modal-name="uploadFile" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t('files.upload.title') }} {{ fmStore.currentPath || t('files.root') }}</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div :class="['border border-2 border-dashed rounded p-3 text-center mb-3', isDragging ? 'border-primary bg-primary bg-opacity-10' : 'border-secondary']"
               @dragenter.prevent="isDragging = true"
               @dragover.prevent="isDragging = true"
               @dragleave.prevent="isDragging = false"
               @drop.prevent="handleDrop">
            <i class="bi bi-cloud-arrow-up-fill fs-3 text-muted"></i>
            <p class="mb-0 text-muted">{{ t('files.upload.hint1') }}</p>
          </div>
          <input class="form-control" type="file" ref="fileInput" @change="handleFileSelect" multiple>

          <!-- Progress list for all queued files -->
          <div v-if="uploads.length > 0" class="mt-3">
            <div v-for="u in uploads" :key="u.id" class="mb-2">
              <div class="d-flex justify-content-between">
                <span class="text-truncate me-2">{{ u.name }}</span>
                <small :class="u.status === 'error' ? 'text-danger' : u.status === 'done' ? 'text-success' : 'text-muted'">
                  {{ u.progress.toFixed(0) }}%
                </small>
              </div>
              <div class="progress" style="height: 5px;">
                <div class="progress-bar"
                     role="progressbar"
                     :style="{ width: u.progress + '%' }"
                     :class="{ 'bg-success': u.status === 'done', 'bg-danger': u.status === 'error' }">
                </div>
              </div>
              <small class="text-muted">{{ u.message }}</small>
            </div>
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
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useFileManagerStore } from '../../stores/fileManager';
import { useFileUpload } from '../../composables/useFileUpload';
import { useI18n } from '../../composables/useI18n';

const uiStore = useUiStore();
const fmStore = useFileManagerStore();
const { t } = useI18n();
const { uploads, uploadFiles } = useFileUpload();

const modalEle = ref(null);
const fileInput = ref(null);
const isDragging = ref(false);
let modal = null;

onMounted(() => {
    modal = new bootstrap.Modal(modalEle.value);
    modalEle.value.addEventListener('hidden.bs.modal', () => uiStore.closeModal('uploadFile'));
    if (uiStore.modals.uploadFile) modal.show();
});
onBeforeUnmount(() => modal?.dispose());

watch(() => uiStore.modals.uploadFile, (isVisible) => {
    if (isVisible) modal.show();
    else modal.hide();
});

const close = () => uiStore.closeModal('uploadFile');

const handleDrop = (e) => {
    isDragging.value = false;
    if (e.dataTransfer?.files?.length) {
        uploadFiles(e.dataTransfer.files);
    }
};

const handleFileSelect = (e) => {
    if (e.target.files?.length) {
        uploadFiles(e.target.files);
        // Reset so the same file can be re-selected if needed
        e.target.value = '';
    }
};
</script>
