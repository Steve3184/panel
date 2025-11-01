<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">Create New {{ type === 'file' ? 'File' : 'Folder' }}</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="new-name-input" class="form-label">Name</label>
              <input type="text" class="form-control" id="new-name-input" v-model="name" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
            <button type="submit" class="btn btn-primary">Create</button>
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
  type: { type: String, required: true, validator: (value) => ['file', 'folder'].includes(value) }
});

const uiStore = useUiStore();
const fmStore = useFileManagerStore();
const modalEle = ref(null);
let modal = null;
const name = ref('');

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.createNewFile
  if (uiStore.modals.createNewFile) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('createNewFile');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('createNewFile');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.createNewFile, (isVisible) => {
  if (isVisible) {
    name.value = '';
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('createNewFile');

const handleSubmit = () => {
  if (props.type === 'file') {
    fmStore.createFile(name.value);
  } else {
    fmStore.createFolder(name.value);
  }
  close();
};
</script>