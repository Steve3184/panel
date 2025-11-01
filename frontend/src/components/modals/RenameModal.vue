<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">Rename</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="rename-new-name" class="form-label">New Name</label>
              <input type="text" class="form-control" id="rename-new-name" v-model="newName" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
            <button type="submit" class="btn btn-primary">Rename</button>
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
const newName = ref('');

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('renameFile');
  });
  // Initial display based on uiStore.modals.renameFile
  if (uiStore.modals.renameFile) {
    modal.show();
  }
});

onBeforeUnmount(() => modal?.dispose());

watch(() => uiStore.modals.renameFile, (isVisible) => {
  if (isVisible && props.file) {
    newName.value = props.file.name;
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('renameFile');

const handleSubmit = () => {
  if (props.file) {
    fmStore.rename(props.file.path, newName.value);
    close();
  }
};
</script>