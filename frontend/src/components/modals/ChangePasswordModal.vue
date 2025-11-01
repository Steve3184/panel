<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <form @submit.prevent="handleSubmit">
          <div class="modal-header">
            <h5 class="modal-title">{{ $t('users.change_password.title') }} {{ user?.username || 'N/A' }}</h5>
            <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div v-if="isCurrentUser" class="mb-3">
              <label for="old-password" class="form-label">{{ $t('users.change_password.old') }}</label>
              <input type="password" class="form-control" id="old-password" v-model="form.oldPassword" required>
            </div>
            <div class="mb-3">
              <label for="new-password" class="form-label">{{ $t('users.change_password.new') }}</label>
              <input type="password" class="form-control" id="new-password" v-model="form.newPassword" required>
            </div>
            <div class="mb-3">
              <label for="confirm-new-password" class="form-label">{{ $t('users.change_password.new.confirm') }}</label>
              <input type="password" class="form-control" id="confirm-new-password" v-model="form.confirmPassword" required>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">{{ $t('cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ $t('save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useUsersStore } from '../../stores/users';
import { useSessionStore } from '../../stores/session';

const props = defineProps({
  user: { type: Object, required: true }
});

const uiStore = useUiStore();
const usersStore = useUsersStore();
const sessionStore = useSessionStore();
const modalEle = ref(null);
let modal = null;

const form = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
});

const isCurrentUser = computed(() => props.user && props.user.id === sessionStore.currentUser.id);

let hiddenListener = null;

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  hiddenListener = () => {
    uiStore.closeModal('changePassword');
  };
  modalEle.value.addEventListener('hidden.bs.modal', hiddenListener);
  if (uiStore.modals.changePassword) {
    modal.show();
  }
});

onBeforeUnmount(() => {
  if (modalEle.value && hiddenListener) {
    modalEle.value.removeEventListener('hidden.bs.modal', hiddenListener);
  }
  modal?.dispose();
});

watch(() => uiStore.modals.changePassword, (isVisible) => {
  if (isVisible) {
    form.value = { oldPassword: '', newPassword: '', confirmPassword: '' };
    modal.show();
  } else {
    modal.hide();
  }
});

const close = () => uiStore.closeModal('changePassword');

const handleSubmit = () => {
  if (form.value.newPassword !== form.value.confirmPassword) {
    uiStore.showToast(i18n.t('error.password_mismatch'), 'danger');
    return;
  }
  const payload = { newPassword: form.value.newPassword };
  if (isCurrentUser.value) {
    payload.oldPassword = form.value.oldPassword;
  }
  usersStore.changePassword(props.user.id, payload);
};
</script>