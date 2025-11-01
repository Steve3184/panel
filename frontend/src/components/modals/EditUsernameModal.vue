<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">Edit Username</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="edit-username-input" class="form-label">New Username</label>
              <input type="text" class="form-control" id="edit-username-input" v-model="newUsername" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
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
import { useUsersStore } from '../../stores/users';

const props = defineProps({
  user: { type: Object, default: null }
});

const uiStore = useUiStore();
const usersStore = useUsersStore();
const modalEle = ref(null);
let modal = null;

const newUsername = ref('');

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.editUsername
  if (uiStore.modals.editUsername) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('editUsername');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('editUsername');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.editUsername, (isVisible) => {
  if (isVisible && props.user) {
    newUsername.value = props.user.username || '';
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('editUsername');

const handleSubmit = () => {
  if (props.user) {
    usersStore.updateUsername(props.user.id, newUsername.value);
  }
};
</script>