<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">{{ t('users.create.title') }}</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label for="create-username" class="form-label">{{ t('users.username') }}</label>
              <input type="text" class="form-control" id="create-username" v-model="form.username" required>
            </div>
            <div class="mb-3">
              <label for="create-password" class="form-label">{{ t('users.password') }}</label>
              <input type="password" class="form-control" id="create-password" v-model="form.password" required>
            </div>
            <div class="mb-3">
              <label for="create-role" class="form-label">{{ t('users.role') }}</label>
              <select class="form-select" id="create-role" v-model="form.role">
                <option value="user">{{ t('users.role.user') }}</option>
                <option value="admin">{{ t('users.role.admin') }}</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">{{ t('cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ t('users.create') }}</button>
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

const uiStore = useUiStore();
const usersStore = useUsersStore();
const modalEle = ref(null);
let modal = null;

const form = ref({
  username: '',
  password: '',
  role: 'user'
});

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.createUser
  if (uiStore.modals.createUser) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('createUser');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('createUser');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.createUser, (isVisible) => {
  if (isVisible) {
    form.value = { username: '', password: '', role: 'user' };
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('createUser');

const handleSubmit = () => {
  usersStore.createUser(form.value);
};
</script>