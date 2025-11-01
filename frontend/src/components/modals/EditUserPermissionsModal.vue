<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ t('users.perms.edit') }} {{ user?.username || 'N/A' }}</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body" v-if="user">
          <div class="mb-3">
            <label for="edit-permissions-role" class="form-label">{{ t('users.account.type') }}</label>
            <select class="form-select" id="edit-permissions-role" :value="user.role" @change="updateRole($event.target.value)" :disabled="isRoleSelectDisabled">
              <option value="user">{{ t('users.role.user') }}</option>
              <option value="admin">{{ t('users.role.admin') }}</option>
            </select>
          </div>
          <div v-if="user.role === 'user'">
            <p>{{ t('users.perms.edit.instances') }}</p>
            <div class="list-group">
              <div v-for="instance in instancesStore.instances" :key="instance.id" class="list-group-item d-flex justify-content-between align-items-center">
                <span>{{ instance.name }}</span>
                <div class="d-flex align-items-center">
                   <div class="form-check form-switch me-3">
                        <input class="form-check-input" type="checkbox" role="switch" :checked="getPermission(instance.id, 'fileManagement')" @change="updatePermission(instance.id, 'fileManagement', $event.target.checked)">
                        <label class="form-check-label">{{ t('users.perms.files') }}</label>
                    </div>
                  <select class="form-select w-auto" :value="getPermission(instance.id, 'terminal')" @change="updatePermission(instance.id, 'terminal', $event.target.value)">
                    <option value="null">{{ t('users.perms.none') }}</option>
                    <option value="read-only">{{ t('users.perms.termro') }}</option>
                    <option value="read-write">{{ t('users.perms.termrw') }}</option>
                    <option value="read-write-ops">{{ t('users.perms.termrw.ops') }}</option>
                    <option value="full-control">{{ t('users.perms.fullcontrol') }}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">{{ t('close') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { Modal } from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useUsersStore } from '../../stores/users';
import { useInstancesStore } from '../../stores/instances';
import { useSessionStore } from '../../stores/session';
import { useI18n } from '../../composables/useI18n';

const { t } = useI18n();

const props = defineProps({
  user: { type: Object, default: null }
});

const uiStore = useUiStore();
const usersStore = useUsersStore();
const instancesStore = useInstancesStore();
const sessionStore = useSessionStore();
const modalEle = ref(null);
let modal = null;

const isRoleSelectDisabled = computed(() => !sessionStore.currentUser || sessionStore.currentUser.id === props.user?.id);

onMounted(() => {
  modal = new Modal(modalEle.value);
  if (instancesStore.instances.length === 0) instancesStore.fetchInstances();
  // Initial display based on uiStore.modals.editUserPermissions
  if (uiStore.modals.editUserPermissions) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('editUserPermissions');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('editUserPermissions');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.editUserPermissions, (isVisible) => {
  if (isVisible) modal.show();
  else modal.hide();
});

const close = () => uiStore.closeModal('editUserPermissions');

const getPermission = (instanceId, type) => {
    const instance = instancesStore.getInstanceById(instanceId);
    const perm = instance?.permissions?.[props.user.id]?.[type];
    return type === 'terminal' ? perm || 'null' : !!perm;
};

const updateRole = (newRole) => {
    usersStore.updateUserRole(props.user.id, newRole);
};

const updatePermission = (instanceId, type, value) => {
    const instance = instancesStore.getInstanceById(instanceId);
    const currentPerms = instance?.permissions?.[props.user.id] || {};
    const newPerms = {
        terminal: currentPerms.terminal,
        fileManagement: currentPerms.fileManagement
    };
    newPerms[type] = type === 'terminal' ? (value === 'null' ? null : value) : value;
    usersStore.updateUserPermission(instanceId, props.user.id, newPerms);
};
</script>