<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ title }}</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <p>{{ message }}</p>
          <p v-if="itemName">{{ $t('confirm.delete') }} <strong>{{ itemName }}</strong></p>
          <p class="text-danger fw-bold">{{ $t('confirm.irreversible') }}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">{{ $t('cancel') }}</button>
          <button type="button" class="btn btn-danger" @click="handleConfirm">{{ $t('confirm.delete.btn') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';

const props = defineProps({
  title: { type: String, required: true },
  message: { type: String, required: true },
  itemName: { type: String, default: '' },
});

const emit = defineEmits(['confirm']);

const uiStore = useUiStore();
const modalEle = ref(null);
let modal = null;

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.confirmDelete
  if (uiStore.modals.confirmDelete) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('confirmDelete');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('confirmDelete');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.confirmDelete, (isVisible) => {
  if (isVisible) {
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => {
  uiStore.closeModal('confirmDelete');
};

const handleConfirm = () => {
  emit('confirm');
  close();
};
</script>