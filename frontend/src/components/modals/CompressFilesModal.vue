<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">{{ $t('files.compress.title') }} {{ fmStore.selectedFiles.size }} {{ $t('files.items') }}</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="compress-output-name" class="form-label">{{ $t('files.filename') }}</label>
              <input type="text" class="form-control" id="compress-output-name" v-model="form.outputName" required>
            </div>
            <div class="mb-3">
              <label for="compress-format" class="form-label">{{ $t('files.compress.format') }}</label>
              <select class="form-select" id="compress-format" v-model="form.format">
                <option value="zip">zip</option>
                <option value="7z">7z</option>
                <option value="tar.gz">tar.gz</option>
                <option value="tar.xz">tar.xz</option>
              </select>
            </div>
            <div class="mb-3">
              <label for="compress-level-slider" class="form-label">{{ $t('files.compress.ratio') }} {{ form.level }}</label>
              <input type="range" class="form-range" id="compress-level-slider" min="0" max="9" v-model="form.level">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">{{ $t('cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ $t('files.compress') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useFileManagerStore } from '../../stores/fileManager';

const uiStore = useUiStore();
const fmStore = useFileManagerStore();
const modalEle = ref(null);
let modal = null;

const form = ref({
  outputName: 'archive',
  format: 'zip',
  level: 5
});

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.compressFiles
  if (uiStore.modals.compressFiles) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('compressFiles');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('compressFiles');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.compressFiles, (isVisible) => {
  if (isVisible) {
    // Set default name based on selection
    if (fmStore.selectedFiles.size === 1) {
        const singleFile = Array.from(fmStore.selectedFiles)[0];
        form.value.outputName = singleFile.split('/').pop().split('.').slice(0, -1).join('.') || 'archive';
    } else {
        form.value.outputName = 'archive';
    }
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('compressFiles');

const handleSubmit = () => {
    const filesToCompress = Array.from(fmStore.selectedFiles);
    const fullOutputName = `${form.value.outputName}.${form.value.format}`;
    fmStore.compress(filesToCompress, fmStore.currentPath, fullOutputName, form.value.format, form.value.level);
    close();
};
</script>