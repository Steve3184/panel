<template>
  <div>
    <div v-if="!fmStore.currentInstanceId">
      <InstanceSelector />
    </div>
    <div v-else>
      <FileManagerHeader
        @create="openCreateNew"
        @delete-selected="openDeleteSelectedConfirm"
        @update:searchQuery="searchQuery = $event"
      />
      <div v-if="fmStore.isLoading" class="text-center p-5">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">{{ t('loading') }}</span>
        </div>
      </div>
      <div v-else
           class="card"
           id="file-browser"
           @dragenter="onDragEnter"
           @dragleave="onDragLeave"
           @dragover.prevent
           @drop.prevent="onDrop">

        <!-- Drag-and-drop overlay -->
        <div v-if="isDraggingOver" class="drop-overlay">
          <i class="bi bi-cloud-arrow-up-fill fs-1 mb-2"></i>
          <p class="mb-0">{{ t('files.upload.hint1') }}</p>
        </div>

        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th style="width: 30px;"><input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll"></th>
                  <th>{{ t('files.table.name') }}</th>
                  <th>{{ t('files.table.size') }}</th>
                  <th>{{ t('files.table.modified') }}</th>
                  <th style="width: 36px;"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="fmStore.currentPath" @dblclick="goUp" @contextmenu.prevent="openContextMenu(null, $event)" class="file-row">
                  <td></td>
                  <td><i class="bi bi-folder-fill ms-1 me-2 text-warning"></i> {{ t('files.go_up') }}</td>
                  <td colspan="3"></td>
                </tr>
                <tr v-for="file in filteredFiles"
                    :key="file.path"
                    @dblclick="navigate(file)"
                    @contextmenu.prevent="openContextMenu(file, $event)"
                    class="file-row">
                  <td><input type="checkbox" :checked="fmStore.selectedFiles.has(file.path)" @change="toggleSelection(file.path)"></td>
                  <td><i :class="getFileIcon(file)" class="ms-1 me-2"></i> {{ truncateFileName(file.name) }}</td>
                  <td class="text-nowrap">{{ file.isDirectory ? '' : formatBytes(file.size) }}</td>
                  <td class="text-nowrap">{{ new Date(file.mtime).toLocaleString() }}</td>
                  <td>
                    <button class="btn btn-sm btn-link p-0 text-muted more-btn"
                            @click.stop="openContextMenuFromButton(file, $event)"
                            :title="t('files.operations')">
                      <i class="bi bi-three-dots-vertical"></i>
                    </button>
                  </td>
                </tr>
                <tr v-if="filteredFiles.length === 0 && !fmStore.currentPath">
                  <td colspan="5" class="text-center text-muted p-4">{{ t('files.directory_empty') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Inline upload progress panel (appears at bottom during drag-drop uploads) -->
        <div v-if="uploads.length > 0" class="upload-progress-panel">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <small class="fw-semibold">{{ t('files.upload.uploading') }}</small>
            <button class="btn btn-sm btn-link p-0 text-muted" @click="clearCompleted">
              <i class="bi bi-x-lg"></i>
            </button>
          </div>
          <div v-for="u in uploads" :key="u.id" class="upload-item mb-1">
            <div class="d-flex justify-content-between">
              <span class="text-truncate me-2" style="max-width: 200px;">{{ u.name }}</span>
              <small :class="u.status === 'error' ? 'text-danger' : u.status === 'done' ? 'text-success' : 'text-muted'">
                {{ u.progress.toFixed(0) }}%
              </small>
            </div>
            <div class="progress" style="height: 3px;">
              <div class="progress-bar"
                   role="progressbar"
                   :style="{ width: u.progress + '%' }"
                   :class="{ 'bg-success': u.status === 'done', 'bg-danger': u.status === 'error' }">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Context menu (teleported to body to avoid overflow clipping) -->
    <Teleport to="body">
      <div v-if="contextMenu.file"
           ref="contextMenuEl"
           class="fm-context-menu"
           :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
           @click.stop>

        <!-- ── Single-file actions (always shown for the right-clicked file) ── -->
        <button v-if="contextMenu.file.isDirectory"
                class="fm-context-item"
                @click="navigate(contextMenu.file); closeContextMenu()">
          <i class="bi bi-folder2-open me-2"></i>{{ t('files.action.open') }}
        </button>
        <button v-if="!contextMenu.file.isDirectory"
                class="fm-context-item"
                @click="downloadFile(contextMenu.file); closeContextMenu()">
          <i class="bi bi-download me-2"></i>{{ t('files.action.download') }}
        </button>
        <button v-if="isExtractable(contextMenu.file)"
                class="fm-context-item"
                @click="openExtract(contextMenu.file); closeContextMenu()">
          <i class="bi bi-box-arrow-in-down-right me-2"></i>{{ t('files.action.extract') }}
        </button>
        <button v-if="isEditable(contextMenu.file)"
                class="fm-context-item"
                @click="openEditor(contextMenu.file); closeContextMenu()">
          <i class="bi bi-pencil-square me-2"></i>{{ t('files.action.edit') }}
        </button>

        <hr class="my-1">

        <!-- Rename: hidden when multiple files are selected (rename is one-at-a-time) -->
        <button v-if="!contextMenuMultiSelect"
                class="fm-context-item"
                @click="openRename(contextMenu.file); closeContextMenu()">
          <i class="bi bi-pencil me-2"></i>{{ t('files.action.rename') }}
        </button>

        <!-- ── Multi-select actions (shown when the right-clicked file is part of the selection) ── -->
        <button v-if="contextMenuMultiSelect"
                class="fm-context-item"
                @click="uiStore.openModal('compressFiles'); closeContextMenu()">
          <i class="bi bi-box-arrow-in-down-right me-2"></i>
          {{ t('files.header.compress') }} ({{ fmStore.selectedFiles.size }})
        </button>

        <!-- Delete: single file when not in a multi-selection, all selected otherwise -->
        <button class="fm-context-item fm-context-item--danger"
                @click="contextMenuMultiSelect ? (openDeleteSelectedConfirm(), closeContextMenu()) : (openDelete(contextMenu.file), closeContextMenu())">
          <i class="bi bi-trash me-2"></i>
          <span v-if="contextMenuMultiSelect">
            {{ t('files.header.delete_selected') }} ({{ fmStore.selectedFiles.size }})
          </span>
          <span v-else>{{ t('files.action.delete') }}</span>
        </button>
      </div>
    </Teleport>

    <CreateNewModal v-if="uiStore.modals.createNewFile" :type="newType" />
    <RenameModal v-if="uiStore.modals.renameFile" :file="selectedFile" />
    <ConfirmDeleteModal
      v-if="uiStore.modals.confirmDelete"
      :title="deleteTarget.title"
      :message="deleteTarget.message"
      :item-name="deleteTarget.name"
      @confirm="confirmDelete"
    />
    <ExtractFileModal v-if="uiStore.modals.extractFile" :file="selectedFile" />
    <CompressFilesModal v-if="uiStore.modals.compressFiles" />
    <UploadFileModal v-if="uiStore.modals.uploadFile" />
    <FileEditorModal v-if="uiStore.modals.fileEditor" :instance-id="fmStore.currentInstanceId" :file-path="selectedFile?.path" />
  </div>
</template>

<script setup>
import { ref, computed, reactive, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useFileManagerStore } from '../../stores/fileManager';
import { useUiStore } from '../../stores/ui';
import { useFileUpload } from '../../composables/useFileUpload';
import InstanceSelector from './InstanceSelector.vue';
import FileManagerHeader from './FileManagerHeader.vue';
import CreateNewModal from '../modals/CreateNewModal.vue';
import RenameModal from '../modals/RenameModal.vue';
import ConfirmDeleteModal from '../modals/ConfirmDeleteModal.vue';
import ExtractFileModal from '../modals/ExtractFileModal.vue';
import CompressFilesModal from '../modals/CompressFilesModal.vue';
import UploadFileModal from '../modals/UploadFileModal.vue';
import FileEditorModal from '../modals/FileEditorModal.vue';
import { useI18n } from '../../composables/useI18n';

const fmStore = useFileManagerStore();
const uiStore = useUiStore();
const { t } = useI18n();
const { uploads, uploadFiles, clearCompleted } = useFileUpload();

const searchQuery = ref('');
const newType = ref('file');
const selectedFile = ref(null);
const deleteTarget = ref({});

// ─── Drag-and-drop ──────────────────────────────────────────────────────────

// Counter trick: dragenter fires for every child, dragleave fires for every child.
// Track net entries so we only hide the overlay when the pointer truly leaves.
const dragEnterCount = ref(0);
const isDraggingOver = computed(() => dragEnterCount.value > 0);

const onDragEnter = (e) => {
    e.preventDefault();
    dragEnterCount.value++;
};
const onDragLeave = () => {
    dragEnterCount.value = Math.max(0, dragEnterCount.value - 1);
};
const onDrop = (e) => {
    dragEnterCount.value = 0;
    const files = e.dataTransfer?.files;
    if (files?.length) uploadFiles(files);
};

// ─── Context menu ────────────────────────────────────────────────────────────

const contextMenuEl = ref(null);
const contextMenu = reactive({ file: null, x: 0, y: 0 });

// True when the right-clicked file is part of a multi-file selection.
// In that case the context menu shows bulk actions instead of single-file ones.
const contextMenuMultiSelect = computed(() =>
    contextMenu.file !== null &&
    fmStore.selectedFiles.size > 1 &&
    fmStore.selectedFiles.has(contextMenu.file.path)
);

const closeContextMenu = () => { contextMenu.file = null; };

const adjustContextMenuPosition = () => {
    if (!contextMenuEl.value) return;
    const rect = contextMenuEl.value.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) contextMenu.x = Math.max(0, vw - rect.width - 8);
    if (rect.bottom > vh - 8) contextMenu.y = Math.max(0, vh - rect.height - 8);
};

const openContextMenu = (file, e) => {
    if (!file) return; // ".." row — no menu
    contextMenu.file = file;
    contextMenu.x = e.clientX;
    contextMenu.y = e.clientY;
    nextTick(adjustContextMenuPosition);
};

// Called by the ⋮ button — position menu below the button
const openContextMenuFromButton = (file, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    contextMenu.file = file;
    contextMenu.x = rect.left;
    contextMenu.y = rect.bottom + 4;
    nextTick(adjustContextMenuPosition);
};

// Close context menu on any click/keydown outside of it
const onDocumentClick = () => closeContextMenu();
const onDocumentKeydown = (e) => { if (e.key === 'Escape') closeContextMenu(); };

onMounted(() => {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
});
onBeforeUnmount(() => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
});

// ─── File list ───────────────────────────────────────────────────────────────

const filteredFiles = computed(() => {
    if (!searchQuery.value) return fmStore.files;
    const q = searchQuery.value.toLowerCase();
    return fmStore.files.filter(f => f.name.toLowerCase().includes(q));
});

const isAllSelected = computed(() =>
    filteredFiles.value.length > 0 && fmStore.selectedFiles.size === filteredFiles.value.length
);

const toggleSelectAll = () => {
    const shouldSelectAll = !isAllSelected.value;
    fmStore.selectedFiles.clear();
    if (shouldSelectAll) filteredFiles.value.forEach(f => fmStore.selectedFiles.add(f.path));
};

const toggleSelection = (path) => {
    if (fmStore.selectedFiles.has(path)) fmStore.selectedFiles.delete(path);
    else fmStore.selectedFiles.add(path);
};

const goUp = () => {
    const parentPath = fmStore.currentPath.substring(0, fmStore.currentPath.lastIndexOf('/'));
    fmStore.loadFiles(parentPath);
};

const navigate = (file) => {
    if (file.isDirectory) fmStore.loadFiles(file.path);
    else if (isEditable(file)) openEditor(file);
};

const getFileIcon = (file) => {
    if (file.isDirectory) return 'bi bi-folder-fill text-warning';
    const n = file.name.toLowerCase();
    if (['.zip','.rar','.7z','.tar','.gz','.tar.gz','.tgz','.bz2','.tar.bz2','.tbz2','.xz','.tar.xz','.txz'].some(e => n.endsWith(e)))
        return 'bi bi-file-earmark-zip-fill text-info';
    if (['.png','.jpg','.jpeg','.gif','.svg','.webp'].some(e => n.endsWith(e)))
        return 'bi bi-file-earmark-image-fill text-success';
    if (['.js','.json','.html','.css','.py','.java','.vue','.ts','.jsx','.tsx','.php','.go','.rb','.c','.cpp','.h','.hpp'].some(e => n.endsWith(e)))
        return 'bi bi-file-earmark-code-fill text-primary';
    if (['.txt','.md','.log'].some(e => n.endsWith(e)))
        return 'bi bi-file-earmark-text-fill text-secondary';
    return 'bi bi-file-earmark';
};

const formatBytes = (bytes) => {
    if (bytes === 0) return `0 ${t('files.size.bytes')}`;
    const k = 1024;
    const sizes = [t('files.size.bytes'), t('files.size.kb'), t('files.size.mb'), t('files.size.gb'), t('files.size.tb')];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const truncateFileName = (name, maxLength = 15) => {
    if (name.length > maxLength) return name.substring(0, maxLength - 3) + '...';
    return name;
};

const isEditable = (file) => !file.isDirectory && file.size < 5 * 1024 * 1024;
const isExtractable = (file) => !file.isDirectory &&
    ['.zip','.rar','.7z','.tar','.gz','.tar.gz','.tgz','.bz2','.tar.bz2','.tbz2','.xz','.tar.xz','.txz']
    .some(e => file.name.toLowerCase().endsWith(e));

const downloadFile = (file) =>
    window.open(`/api/instances/${fmStore.currentInstanceId}/download/${encodeURIComponent(file.path)}`, '_blank');

const openCreateNew = (type) => { newType.value = type; uiStore.openModal('createNewFile'); };
const openRename = (file) => { selectedFile.value = file; uiStore.openModal('renameFile'); };
const openExtract = (file) => { selectedFile.value = file; uiStore.openModal('extractFile'); };
const openEditor = (file) => { selectedFile.value = file; uiStore.openModal('fileEditor'); };

const openDelete = (file) => {
    deleteTarget.value = {
        type: 'single',
        title: t('files.delete.confirm.title'),
        message: t('files.delete.confirm.message'),
        name: file.name,
        path: file.path
    };
    uiStore.openModal('confirmDelete');
};

const openDeleteSelectedConfirm = () => {
    deleteTarget.value = {
        type: 'multiple',
        title: t('files.delete.confirm.multiple.title'),
        message: t('files.delete.confirm.multiple.message', { count: fmStore.selectedFiles.size }),
        name: '',
        paths: Array.from(fmStore.selectedFiles)
    };
    uiStore.openModal('confirmDelete');
};

const confirmDelete = () => {
    if (deleteTarget.value.type === 'single') fmStore.deleteFile(deleteTarget.value.path);
    else if (deleteTarget.value.type === 'multiple') fmStore.deleteMultiple(deleteTarget.value.paths);
};
</script>

<style scoped>
#file-browser {
    height: calc(100vh - 200px);
    height: calc(100dvh - 200px);
    overflow-y: auto;
    position: relative; /* needed for the drop overlay */
}

.file-row { cursor: pointer; }

.more-btn {
    opacity: 0;
    transition: opacity 0.15s;
}
.file-row:hover .more-btn,
.file-row:focus-within .more-btn {
    opacity: 1;
}

/* ─── Drag-and-drop overlay ─────────────────────────────────────────── */
.drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(var(--bs-primary-rgb), 0.08);
    border: 2px dashed var(--bs-primary);
    border-radius: var(--bs-border-radius);
    pointer-events: none;
    color: var(--bs-primary);
    font-size: 1.1rem;
    gap: 0.25rem;
}

/* ─── Inline upload progress ────────────────────────────────────────── */
.upload-progress-panel {
    position: sticky;
    bottom: 0;
    background: var(--bs-body-bg);
    border-top: 1px solid var(--bs-border-color);
    padding: 0.5rem 0.75rem;
    z-index: 5;
}
.upload-item { font-size: 0.82rem; }

/* ─── Context menu ──────────────────────────────────────────────────── */
</style>

<!-- Context menu lives outside <style scoped> so it applies to the teleported element -->
<style>
.fm-context-menu {
    position: fixed;
    z-index: 9999;
    min-width: 170px;
    padding: 4px 0;
    background: var(--bs-body-bg);
    border: 1px solid var(--bs-border-color);
    border-radius: var(--bs-border-radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.fm-context-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 14px;
    font-size: 0.875rem;
    background: transparent;
    border: none;
    text-align: left;
    color: var(--bs-body-color);
    cursor: pointer;
    white-space: nowrap;
}
.fm-context-item:hover {
    background: var(--bs-tertiary-bg);
}
.fm-context-item--danger { color: var(--bs-danger); }
.fm-context-item--danger:hover { background: rgba(var(--bs-danger-rgb), 0.1); }
.fm-context-menu hr { margin: 4px 0; border-color: var(--bs-border-color); }
</style>
