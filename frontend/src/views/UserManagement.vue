<template>
  <div class="d-flex">
    <Sidebar />
    <main id="main-content">
      <AppHeader :page-title="$t('title.users')" />

      <!-- User Management Page -->
      <div id="users-page">
        <div class="d-flex justify-content-between align-items-center pb-2 mb-3 border-bottom">
          <input type="text" class="form-control me-2" v-model="searchTerm" :placeholder="$t('users.search.placeholder')" style="max-width: 300px;">
          <button class="btn btn-primary" @click="uiStore.openModal('createUser')">
            <i class="bi bi-person-plus-fill"></i>
          </button>
        </div>

        <div class="card">
          <div class="card-body">
            <div class="table-responsive">
              <table class="table table-hover">
                <thead>
                  <tr>
                    <th>{{ $t('users.username') }}</th>
                    <th>{{ $t('users.role') }}</th>
                    <th>{{ $t('users.actions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="user in filteredUsers" :key="user.id">
                    <td>
                      {{ user.username }}
                      <button class="btn btn-sm btn-outline-secondary ms-2" @click="openEditUsername(user)">
                        <i class="bi bi-pencil-square"></i>
                      </button>
                    </td>
                    <td>{{ user.role }}</td>
                    <td class="text-end">
                      <button class="btn btn-sm btn-warning me-2" @click="openChangePassword(user)">
                        <i class="bi bi-key me-1"></i> {{ $t('users.change_password') }}
                      </button>
                      <button class="btn btn-sm btn-info me-2" @click="openPermissions(user)">
                        <i class="bi bi-shield-lock me-1"></i> {{ $t('users.edit_permissions') }}
                      </button>
                      <button class="btn btn-sm btn-danger" @click="openDeleteConfirm(user)" :disabled="sessionStore.currentUser.id === user.id">
                        <i class="bi bi-trash me-1"></i> {{ $t('users.delete') }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="filteredUsers.length === 0">
                    <td colspan="3" class="text-center text-muted">{{ $t('users.no_users_found') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Modals -->
  <CreateUserModal v-if="uiStore.modals.createUser" />
  <EditUserPermissionsModal v-if="uiStore.modals.editUserPermissions" :user="selectedUser" />
  <EditUsernameModal v-if="uiStore.modals.editUsername" :user="selectedUser" />
  <ConfirmDeleteModal v-if="uiStore.modals.confirmDelete"
    :item-name="selectedUser?.username"
    :title="$t('users.delete.title')"
    :message="$t('users.delete.irreversible')"
    @confirm="confirmDelete"
  />

</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useUsersStore } from '../stores/users';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import Sidebar from '../components/Sidebar.vue';
import AppHeader from '../components/AppHeader.vue';
// Import Modals
import CreateUserModal from '../components/modals/CreateUserModal.vue';
import EditUserPermissionsModal from '../components/modals/EditUserPermissionsModal.vue';
import EditUsernameModal from '../components/modals/EditUsernameModal.vue';
import ConfirmDeleteModal from '../components/modals/ConfirmDeleteModal.vue';

const usersStore = useUsersStore();
const sessionStore = useSessionStore();
const uiStore = useUiStore();

const searchTerm = ref('');
const selectedUser = ref(null);

onMounted(() => {
  usersStore.fetchUsers();
});

const filteredUsers = computed(() => {
  if (!searchTerm.value) {
    return usersStore.users;
  }
  const term = searchTerm.value.toLowerCase();
  return usersStore.users.filter(user => user.username.toLowerCase().includes(term));
});

function openModalWithUser(modalName, user) {
    selectedUser.value = user;
    uiStore.openModal(modalName);
}

const openEditUsername = (user) => openModalWithUser('editUsername', user);
const openChangePassword = (user) => {
    uiStore.selectedUserForPasswordChange = user;
    uiStore.openModal('changePassword');
};
const openPermissions = (user) => openModalWithUser('editUserPermissions', user);
const openDeleteConfirm = (user) => openModalWithUser('confirmDelete', user);


function confirmDelete() {
    if (selectedUser.value) {
        usersStore.deleteUser(selectedUser.value.id);
    }
}
</script>