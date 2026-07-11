import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import { useI18n } from '../composables/useI18n';
import api from '../services/api'; // Import api service
import { Modal } from 'bootstrap';

export const useUiStore = defineStore('ui', () => {
    const { t } = useI18n();
    const isSidebarCollapsed = ref(false);
    const activePage = ref('overview'); // For switching between 'overview' and 'file-manager' in Dashboard
    const panelLogo = ref('');
    const panelBackground = ref(''); // New state for panel background
    const panelSettings = ref(null); // New state for panel settings
    const capabilities = ref({ platform: null, shellSandbox: { supported: false, reason: 'not-checked' } });
    const themeMode = ref('auto'); // 'light', 'dark', or 'auto'
    
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
        panelSettings: false, // Add panel settings modal
    });

    const selectedUserForPasswordChange = ref(null); // New state for user whose password is to be changed

    const toasts = ref([]);
    const activeProgressToasts = new Map();

    function updatePanelLogo(newPanelLogo) {
        panelLogo.value = newPanelLogo;
    }

    function updatePanelBackground(newPanelBackground) {
        panelBackground.value = newPanelBackground;
    }

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

    async function _fetchPanelSettings() {
        try {
            const settings = await api.getPanelSettings();
            panelSettings.value = settings;
            panelLogo.value = settings.panelLogo;
        } catch (error) {
            console.error(error);
        }
    }

    async function fetchPublicPanelSettings() {
        try {
            const settings = await api.getPublicPanelSettings();
            panelLogo.value = settings.panelLogo || '';
            return settings;
        } catch (error) {
            console.error(error);
            return null;
        }
    }

    function closeModal(modalName) {
        if (modalName in modals) {
            const modalElement = document.querySelector(`[data-modal-name="${modalName}"]`);
            const modalInstance = modalElement ? Modal.getInstance(modalElement) : null;
            if (modalElement?.classList.contains('show') && modalInstance) {
                modalInstance.hide();
                return;
            }
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
            
            const newToast = reactive({ id, message, type: 'primary', progress: msg.progress });
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

        setTimeout(() => {
            removeToast(id);
            activeProgressToasts.delete(id);
        }, 5000);
    }


    function setThemeMode(mode) {
        themeMode.value = mode;
        localStorage.setItem('themeMode', mode);
        applyTheme(mode);
    }

    function applyTheme(mode) {
        const htmlElement = document.documentElement;
        htmlElement.removeAttribute('data-bs-theme'); // Remove existing theme

        if (mode === 'auto') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            htmlElement.setAttribute('data-bs-theme', prefersDark ? 'dark' : 'light');
        } else {
            htmlElement.setAttribute('data-bs-theme', mode);
        }
    }

    // Initialize theme from localStorage or system preference
    const storedTheme = localStorage.getItem('themeMode');
    if (storedTheme) {
        themeMode.value = storedTheme;
    } else {
        themeMode.value = 'auto';
    }
    applyTheme(themeMode.value);

    // Listen for system theme changes if in auto mode
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (themeMode.value === 'auto') {
            applyTheme('auto');
        }
    });

    return {
        isSidebarCollapsed,
        activePage,
        modals,
        selectedUserForPasswordChange,
        toasts,
        panelLogo,
        themeMode,
        panelSettings,
        capabilities,
        panelBackground,
        updatePanelLogo,
        updatePanelBackground,
        toggleSidebar,
        setActivePage,
        openModal,
        closeModal,
        showToast,
        removeToast,
        updateProgressToast,
        updateStatusToast,
        fetchPanelSettings: _fetchPanelSettings,
        fetchPublicPanelSettings,
        setThemeMode
    };
});
