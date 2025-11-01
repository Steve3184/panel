import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import { useI18n } from '../composables/useI18n';

export const useUiStore = defineStore('ui', () => {
    const { t } = useI18n();
    const isSidebarCollapsed = ref(false);
    const activePage = ref('overview'); // For switching between 'overview' and 'file-manager' in Dashboard
    
    // Modal visibility state
    const modals = reactive({
        createInstance: false,
        instanceSettings: false,
        createUser: false,
        editUserPermissions: false,
        changePassword: false,
        editUsername: false,
        confirmDelete: false,
        // File Manager Modals
        uploadFile: false,
        renameFile: false,
        createNewFile: false,
        compressFiles: false,
        extractFile: false,
        fileEditor: false,
        // Docker Modals
        portForwarding: false,
        volumeMounting: false,
        // Other Modals
        changeLanguage: false,
    });

    const selectedUserForPasswordChange = ref(null); // New state for user whose password is to be changed

    const toasts = ref([]);
    const activeProgressToasts = new Map();

    function toggleSidebar() {
        isSidebarCollapsed.value = !isSidebarCollapsed.value;
    }

    function setActivePage(page) {
        activePage.value = page;
    }

    function openModal(modalName) {
        if (modalName in modals) {
            modals[modalName] = true;
        }
    }

    function closeModal(modalName) {
        if (modalName in modals) {
            modals[modalName] = false;
        }
    }
    
    function showToast(message, type = 'info', duration = 5000) {
        const id = Date.now() + Math.random();
        toasts.value.push({ id, message, type });
        if (duration > 0) {
            setTimeout(() => removeToast(id), duration);
        }
    }

    function removeToast(id) {
        toasts.value = toasts.value.filter(toast => toast.id !== id);
    }

    function updateProgressToast(msg) {
        const id = msg.extractId || msg.compressId;
        if (!id) return;
        
        let toast = activeProgressToasts.get(id);
        if (!toast) {
            const message = msg.type === 'file-extract-progress' 
                ? t('files.progress.extract', { fileName: msg.fileName })
                : t('files.progress.compress', { outputName: msg.outputName });
            
            const newToast = reactive({ id, message, type: 'primary', progress: msg.progress }); // 使用 'primary' 类型，通常为蓝色背景白色文字
            toasts.value.push(newToast);
            activeProgressToasts.set(id, newToast);
        } else {
            Object.assign(toast, { progress: msg.progress });
        }
    }

    function updateStatusToast(msg) {
        const id = msg.extractId || msg.compressId;
        if (!id) return;

        let toast = activeProgressToasts.get(id);
        if (!toast) return;

        if (msg.status === 'success') {
            toast.type = 'success';
            toast.progress = 100;
            toast.message = msg.type === 'file-extract-status'
                ? t('files.progress.extract.success', { fileName: msg.fileName })
                : t('files.progress.compress.success', { outputName: msg.outputName });
        } else {
            toast.type = 'danger';
            toast.progress = 0;
            toast.message = msg.type === 'file-extract-status'
                ? t('files.progress.extract.failed', { fileName: msg.fileName, error: msg.error })
                : t('files.progress.compress.failed', { outputName: msg.outputName, error: msg.error });
        }

        // Remove the toast after a delay and clear from the map
        setTimeout(() => {
            removeToast(id);
            activeProgressToasts.delete(id);
        }, 5000);
    }


    return {
        isSidebarCollapsed,
        activePage,
        modals,
        selectedUserForPasswordChange,
        toasts,
        toggleSidebar,
        setActivePage,
        openModal,
        closeModal,
        showToast,
        removeToast,
        updateProgressToast,
        updateStatusToast
    };
});