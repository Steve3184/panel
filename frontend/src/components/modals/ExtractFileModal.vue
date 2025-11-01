<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">Extract File</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">File to Extract</label>
              <input type="text" class="form-control" :value="file?.name" readonly>
            </div>
            <div class="mb-3">
              <label for="extract-destination-path" class="form-label">Destination (relative to current folder)</label>
              <input type="text" class="form-control" id="extract-destination-path" v-model="destinationPath" placeholder="Leave blank for current folder">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
            <button type="submit" class="btn btn-primary">Extract</button>
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

const props = defineProps({
  file: { type: Object, default: null }
});

const uiStore = useUiStore();
const fmStore = useFileManagerStore();
const modalEle = ref(null);
let modal = null;

const destinationPath = ref('');

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.extractFile
  if (uiStore.modals.extractFile) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('extractFile');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('extractFile');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.extractFile, (isVisible) => {
  if (isVisible) {
    destinationPath.value = '';
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('extractFile');

const handleSubmit = () => {
  if (props.file) {
    fmStore.extract(props.file.path, destinationPath.value);
    close();
  }
};
</script>