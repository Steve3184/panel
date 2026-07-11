import { reactive } from 'vue';
import { useFileManagerStore } from '../stores/fileManager';
import { useUiStore } from '../stores/ui';
import { useI18n } from './useI18n';

/**
 * Composable that encapsulates chunked file upload logic.
 * Used by both FileBrowser (drag-drop) and UploadFileModal.
 */
export function useFileUpload() {
    const fmStore = useFileManagerStore();
    const uiStore = useUiStore();
    const { t } = useI18n();

    // Reactive list of in-progress/completed uploads for progress display
    const uploads = reactive([]);

    const uploadFile = async (file) => {
        if (!file || !fmStore.currentInstanceId) return;

        const entry = reactive({
            id: Date.now() + Math.random(),
            name: file.name,
            progress: 0,
            message: '',
            status: 'uploading' // 'uploading' | 'done' | 'error'
        });
        uploads.push(entry);

        const CHUNK_SIZE = 1024 * 1024; // 1 MB
        let offset = 0;

        try {
            entry.message = t('files.upload.initializing_status');

            const initRes = await fetch(`/api/instances/${fmStore.currentInstanceId}/upload/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    fileSize: file.size,
                    targetDirectory: fmStore.currentPath
                })
            });
            if (!initRes.ok) throw new Error(await initRes.text());
            const { uploadId } = await initRes.json();

            while (offset < file.size) {
                const chunk = file.slice(offset, offset + CHUNK_SIZE);
                const formData = new FormData();
                formData.append('uploadId', uploadId);
                formData.append('chunkIndex', Math.floor(offset / CHUNK_SIZE));
                formData.append('chunk', chunk);

                const chunkRes = await fetch(
                    `/api/instances/${fmStore.currentInstanceId}/upload/chunk`,
                    { method: 'POST', body: formData }
                );
                if (!chunkRes.ok) throw new Error(await chunkRes.text());

                offset += chunk.size;
                entry.progress = (offset / file.size) * 100;
                entry.message = t('files.upload.uploading_status', {
                    uploaded: Math.round(offset / 1024),
                    total: Math.round(file.size / 1024)
                });
            }

            const completeRes = await fetch(`/api/instances/${fmStore.currentInstanceId}/upload/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId, fileName: file.name, destinationPath: fmStore.currentPath })
            });
            if (!completeRes.ok) throw new Error(await completeRes.text());

            entry.progress = 100;
            entry.message = t('files.upload.complete');
            entry.status = 'done';
            fmStore.loadFiles(fmStore.currentPath);
            // Auto-remove this entry after 3 s so the progress panel hides itself
            setTimeout(() => {
                const i = uploads.indexOf(entry);
                if (i !== -1) uploads.splice(i, 1);
            }, 3000);
        } catch (error) {
            entry.message = `${t('error.title')}: ${error.message}`;
            entry.status = 'error';
            uiStore.showToast(entry.message, 'danger');
        }
    };

    /**
     * Upload multiple files concurrently.
     * Each file gets its own entry in the uploads list.
     */
    const uploadFiles = (files) => {
        Array.from(files).forEach(f => uploadFile(f));
    };

    const clearCompleted = () => {
        const toRemove = uploads.filter(u => u.status === 'done' || u.status === 'error');
        toRemove.forEach(u => {
            const i = uploads.indexOf(u);
            if (i !== -1) uploads.splice(i, 1);
        });
    };

    return { uploads, uploadFile, uploadFiles, clearCompleted };
}
