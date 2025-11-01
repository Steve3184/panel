import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../services/api';
import { useUiStore } from './ui';

export const useSessionStore = defineStore('session', () => {
    const router = useRouter();
    const uiStore = useUiStore();
    const currentUser = ref(null);
    const isAuthenticated = ref(false);

    async function checkSession() {
        try {
            const data = await api.checkSession();
            currentUser.value = data.user;
            isAuthenticated.value = true;
            return true;
        } catch (error) {
            currentUser.value = null;
            isAuthenticated.value = false;
            // 如果不在登录或设置页面，则重定向
            if (router.currentRoute.value.name !== 'Login' && router.currentRoute.value.name !== 'Setup') {
                 router.push('/login');
            }
            return false;
        }
    }
    
    async function login(credentials) {
        try {
            await api.login(credentials);
            await checkSession();
            router.push('/');
        } catch (error) {
            uiStore.showToast(error.message, 'danger');
        }
    }

    async function logout() {
        await api.logout();
        currentUser.value = null;
        isAuthenticated.value = false;
        router.push('/login');
    }

    return { currentUser, isAuthenticated, checkSession, login, logout };
});