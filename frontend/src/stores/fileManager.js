import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import api from '../services/api';
import { useUiStore } from './ui';
import { useI18n } from '../composables/useI18n';

export const useFileManagerStore = defineStore('fileManager', () => {
    const uiStore = useUiStore();
    const { t } = useI18n();

    const currentInstanceId = ref(null);
    const currentPath = ref('');
    const files = ref([]);
    const isLoading = ref(false);
    const selectedFiles = reactive(new Set());
    const clipboard = reactive({
        operation: null, // 'copy' or 'cut'
        files: []
    });

    async function selectInstance(instanceId) {
        currentInstanceId.value = instanceId;
        await loadFiles(''); // Load root directory
    }
    
    async function loadFiles(path) {
        if (!currentInstanceId.value) return;
        isLoading.value = true;
        try {
            currentPath.value = path;
            const fileList = await api.getFiles(currentInstanceId.value, path);
            // Sort folders first, then by name
            files.value = fileList.sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name);
            });
        } catch (error) {
            uiStore.showToast(t('files.load.failed_toast', { message: t(error.message) }), 'danger');
            // Reset to instance selection on error
            currentInstanceId.value = null;
        } finally {
            isLoading.value = false;
        }
    }

    function handleFileChange(msg) {
        // If the change is relevant to the current view, refresh
        if (msg.instanceId === currentInstanceId.value) {
            const changeDir = msg.path?.substring(0, msg.path.lastIndexOf('/')) || '';
            if (changeDir === currentPath.value || msg.destinationPath === currentPath.value) {
                 loadFiles(currentPath.value);
            }
        }
    }

    async function performOperation(operation, ...args) {
        try {
            await api[operation](currentInstanceId.value, ...args);
            uiStore.showToast(t('files.operation.success', { operation: operation }), 'success');
            await loadFiles(currentPath.value);
            // Clear selections and clipboard after move/cut
            if (operation === 'move') {
                clipboard.operation = null;
                clipboard.files = [];
            }
            selectedFiles.clear();
        } catch (error) {
            uiStore.showToast(t('files.operation.failed', { operation: operation, message: t(error.message) }), 'danger');
        }
    }

    return {
        currentInstanceId,
        currentPath,
        files,
        isLoading,
        selectedFiles,
        clipboard,
        selectInstance,
        loadFiles,
        handleFileChange,
        // File Actions
        createFolder: (name) => performOperation('createFolder', currentPath.value, name),
        createFile: (name) => performOperation('createFile', currentPath.value, name),
        rename: (oldPath, newName) => performOperation('rename', oldPath, newName),
        deleteFile: (path) => performOperation('delete', path),
        deleteMultiple: (paths) => performOperation('deleteMultiple', paths),
        copy: (destination) => performOperation('copy', clipboard.files, destination),
        move: (destination) => performOperation('move', clipboard.files, destination),
        extract: (filePath, dest) => performOperation('extract', filePath, dest),
        compress: (files, dest, outName, format, level) => performOperation('compress', files, dest, outName, format, level)
    };
});