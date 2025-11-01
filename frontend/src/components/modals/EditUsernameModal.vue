<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">{{ t('users.change_username.title') }}</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="edit-username-input" class="form-label">{{ t('users.change_username.new') }}</label>
              <input type="text" class="form-control" id="edit-username-input" v-model="newUsername" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">{{ t('cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ t('save') }}</button>
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
import { useI18n } from '../../composables/useI18n';

const { t } = useI18n();

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
    newUsername.value = props.user.username || '';
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