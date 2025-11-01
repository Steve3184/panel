import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import { useUiStore } from './ui';
import { useInstancesStore } from './instances';
import { useI18n } from '../composables/useI18n';

export const useUsersStore = defineStore('users', () => {
    const uiStore = useUiStore();
    const instancesStore = useInstancesStore();
    const { t } = useI18n();
    const users = ref([]);

    async function fetchUsers() {
        try {
            users.value = await api.getUsers();
        } catch (error) {
            uiStore.showToast(t('users.fetch.failed', { message: t(error.message) }), 'danger');
        }
    }

    async function createUser(userData) {
        try {
            await api.createUser(userData);
            uiStore.showToast(t('users.create.success'), 'success');
            uiStore.closeModal('createUser');
            await fetchUsers();
        } catch (error) {
            uiStore.showToast(t('users.create.failed', { message: t(error.message) }), 'danger');
        }
    }

    async function deleteUser(userId) {
        try {
            await api.deleteUser(userId);
            uiStore.showToast(t('users.delete.success'), 'success');
            uiStore.closeModal('confirmDelete');
            await fetchUsers();
            await instancesStore.fetchInstances(); // Refresh instances to update permissions
        } catch (error) {
            uiStore.showToast(t('users.delete.failed', { message: t(error.message) }), 'danger');
        }
    }
    
    async function updateUserRole(userId, role) {
        try {
            await api.updateUserRole(userId, role);
            uiStore.showToast(t('users.role.update.success'), 'success');
            await fetchUsers();
        } catch (error) {
            uiStore.showToast(t('users.role.update.failed', { message: t(error.message) }), 'danger');
        }
    }
    
    async function updateUsername(userId, username) {
        try {
            await api.updateUsername(userId, username);
            uiStore.showToast(t('users.username.update.success'), 'success');
            uiStore.closeModal('editUsername');
            await fetchUsers();
            // If current user, update session store too
            const sessionStore = useSessionStore();
            if (sessionStore.currentUser.id === userId) {
                await sessionStore.checkSession();
            }
        } catch (error) {
             uiStore.showToast(t('users.username.update.failed', { message: t(error.message) }), 'danger');
        }
    }

    async function changePassword(userId, passwords) {
        try {
            await api.changePassword(userId, passwords);
            uiStore.showToast(t('users.password.change.success'), 'success');
            uiStore.closeModal('changePassword');
        } catch (error) {
             uiStore.showToast(t('users.password.change.failed', { message: t(error.message) }), 'danger');
        }
    }

    async function updateUserPermission(instanceId, userId, permissions) {
        try {
            await api.updateUserPermission(instanceId, userId, permissions);
            uiStore.showToast(t('users.permissions.update.success'), 'success');
            await instancesStore.fetchInstances(); // Refresh instance data
        } catch (error) {
            uiStore.showToast(t('users.permissions.update.failed', { message: t(error.message) }), 'danger');
        }
    }

    return {
        users,
        fetchUsers,
        createUser,
        deleteUser,
        updateUserRole,
        updateUsername,
        changePassword,
        updateUserPermission
    };
});