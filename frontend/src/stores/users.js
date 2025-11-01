import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../services/api';
import { useUiStore } from './ui';
import { useInstancesStore } from './instances';

export const useUsersStore = defineStore('users', () => {
    const uiStore = useUiStore();
    const instancesStore = useInstancesStore();
    const users = ref([]);

    async function fetchUsers() {
        try {
            users.value = await api.getUsers();
        } catch (error) {
            uiStore.showToast(`Failed to fetch users: ${error.message}`, 'danger');
        }
    }

    async function createUser(userData) {
        try {
            await api.createUser(userData);
            uiStore.showToast('User created successfully.', 'success');
            uiStore.closeModal('createUser');
            await fetchUsers();
        } catch (error) {
            uiStore.showToast(`Failed to create user: ${error.message}`, 'danger');
        }
    }

    async function deleteUser(userId) {
        try {
            await api.deleteUser(userId);
            uiStore.showToast('User deleted successfully.', 'success');
            uiStore.closeModal('confirmDelete');
            await fetchUsers();
            await instancesStore.fetchInstances(); // Refresh instances to update permissions
        } catch (error) {
            uiStore.showToast(`Failed to delete user: ${error.message}`, 'danger');
        }
    }
    
    async function updateUserRole(userId, role) {
        try {
            await api.updateUserRole(userId, role);
            uiStore.showToast("User role updated.", 'success');
            await fetchUsers();
        } catch (error) {
            uiStore.showToast(`Failed to update role: ${error.message}`, 'danger');
        }
    }
    
    async function updateUsername(userId, username) {
        try {
            await api.updateUsername(userId, username);
            uiStore.showToast("Username updated.", 'success');
            uiStore.closeModal('editUsername');
            await fetchUsers();
            // If current user, update session store too
            const sessionStore = useSessionStore();
            if (sessionStore.currentUser.id === userId) {
                await sessionStore.checkSession();
            }
        } catch (error) {
             uiStore.showToast(`Failed to update username: ${error.message}`, 'danger');
        }
    }

    async function changePassword(userId, passwords) {
        try {
            await api.changePassword(userId, passwords);
            uiStore.showToast("Password changed successfully.", 'success');
            uiStore.closeModal('changePassword');
        } catch (error) {
             uiStore.showToast(`Failed to change password: ${error.message}`, 'danger');
        }
    }

    async function updateUserPermission(instanceId, userId, permissions) {
        try {
            await api.updateUserPermission(instanceId, userId, permissions);
            uiStore.showToast("Permissions updated.", 'success');
            await instancesStore.fetchInstances(); // Refresh instance data
        } catch (error) {
            uiStore.showToast(`Failed to update permissions: ${error.message}`, 'danger');
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