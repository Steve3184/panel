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
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
      <div v-else class="card" id="file-browser">
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead>
                <tr>
                  <th style="width: 30px;"><input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll"></th>
                  <th>Name</th>
                  <th class="d-none d-md-table-cell">Size</th>
                  <th class="d-none d-md-table-cell">Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="fmStore.currentPath" @dblclick="goUp" class="file-row">
                    <td></td>
                    <td><i class="bi bi-folder-fill ms-1 me-2 text-warning"></i> ..</td>
                    <td colspan="2"></td>
                </tr>
                <tr v-for="file in filteredFiles" :key="file.path" @dblclick="navigate(file)" class="file-row">
                    <td><input type="checkbox" :checked="fmStore.selectedFiles.has(file.path)" @change="toggleSelection(file.path)"></td>
                    <td><i :class="getFileIcon(file)" class="ms-1 me-2"></i> {{ truncateFileName(file.name) }}</td>
                    <td class="d-none d-md-table-cell">{{ file.isDirectory ? '' : formatBytes(file.size) }}</td>
                    <td class="d-none d-md-table-cell">{{ new Date(file.mtime).toLocaleString() }}</td>
                    <td class="file-actions">
                         <button v-if="!file.isDirectory" class="btn btn-sm btn-primary me-2" @click.stop="downloadFile(file)" title="Download">
                            <i class="bi bi-download"></i>
                         </button>
                         <button v-if="isExtractable(file)" class="btn btn-sm btn-secondary me-2" @click.stop="openExtract(file)" title="Extract">
                            <i class="bi bi-box-arrow-in-down-right"></i>
                         </button>
                         <button v-if="isEditable(file)" class="btn btn-sm btn-info me-2" @click.stop="openEditor(file)" title="Edit">
                            <i class="bi bi-pencil-square"></i>
                         </button>
                         <button class="btn btn-sm btn-warning me-2" @click.stop="openRename(file)" title="Rename">
                            <i class="bi bi-pencil"></i>
                         </button>
                           <button class="btn btn-sm btn-danger me-2" @click.stop="openDelete(file)" title="Delete">
                            <i class="bi bi-trash"></i>
                         </button>
                    </td>
                </tr>
                <tr v-if="filteredFiles.length === 0 && !fmStore.currentPath">
                    <td colspan="6" class="text-center text-muted p-4">This directory is empty.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    
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
import { ref, computed, watch } from 'vue';
import { useFileManagerStore } from '../../stores/fileManager';
import { useUiStore } from '../../stores/ui';
import InstanceSelector from './InstanceSelector.vue';
import FileManagerHeader from './FileManagerHeader.vue';
import CreateNewModal from '../modals/CreateNewModal.vue';
import RenameModal from '../modals/RenameModal.vue';
import ConfirmDeleteModal from '../modals/ConfirmDeleteModal.vue';
import ExtractFileModal from '../modals/ExtractFileModal.vue';
import CompressFilesModal from '../modals/CompressFilesModal.vue';
import UploadFileModal from '../modals/UploadFileModal.vue';
import FileEditorModal from '../modals/FileEditorModal.vue';

const fmStore = useFileManagerStore();
const uiStore = useUiStore();

const searchQuery = ref('');
const newType = ref('file');
const selectedFile = ref(null);
const deleteTarget = ref({});

const filteredFiles = computed(() => {
  if (!searchQuery.value) {
    return fmStore.files;
  }
  const lowerCaseSearchQuery = searchQuery.value.toLowerCase();
  return fmStore.files.filter(file => file.name.toLowerCase().includes(lowerCaseSearchQuery));
});

const isAllSelected = computed(() => filteredFiles.value.length > 0 && fmStore.selectedFiles.size === filteredFiles.value.length);

const toggleSelectAll = () => {
    const shouldSelectAll = !isAllSelected.value;
    fmStore.selectedFiles.clear();
    if (shouldSelectAll) {
        filteredFiles.value.forEach(file => fmStore.selectedFiles.add(file.path));
    }
};

const toggleSelection = (path) => {
    if (fmStore.selectedFiles.has(path)) {
        fmStore.selectedFiles.delete(path);
    } else {
        fmStore.selectedFiles.add(path);
    }
};

const goUp = () => {
    const parentPath = fmStore.currentPath.substring(0, fmStore.currentPath.lastIndexOf('/'));
    fmStore.loadFiles(parentPath);
};

const navigate = (file) => {
    if (file.isDirectory) {
        fmStore.loadFiles(file.path);
    } else {
        if (isEditable(file)) openEditor(file);
    }
};

const getFileIcon = (file) => {
    if (file.isDirectory) return 'bi bi-folder-fill text-warning';
    const fileNameLower = file.name.toLowerCase();
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz', '.tgz', '.bz2', '.tar.bz2', '.tbz2', '.xz', '.tar.xz', '.txz'].some(ext => fileNameLower.endsWith(ext))) return 'bi bi-file-earmark-zip-fill text-info';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].some(ext => fileNameLower.endsWith(ext))) return 'bi bi-file-earmark-image-fill text-success';
    if (['.js', '.json', '.html', '.css', '.py', '.java', '.vue', '.ts', '.jsx', '.tsx', '.php', '.go', '.rb', '.c', '.cpp', '.h', '.hpp'].some(ext => fileNameLower.endsWith(ext))) return 'bi bi-file-earmark-code-fill text-primary';
    if (['.txt', '.md', '.log'].some(ext => fileNameLower.endsWith(ext))) return 'bi bi-file-earmark-text-fill text-secondary';
    return 'bi bi-file-earmark';
};
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
const truncateFileName = (fileName, maxLength = 15) => {
  if (fileName.length > maxLength) {
    return fileName.substring(0, maxLength - 3) + '...';
  }
  return fileName;
};

const isEditable = (file) => !file.isDirectory && file.size < 5 * 1024 * 1024; // 5MB limit
const isExtractable = (file) => !file.isDirectory && ['.zip', '.rar', '.7z', '.tar', '.gz', '.tar.gz', '.tgz', '.bz2', '.tar.bz2', '.tbz2', '.xz', '.tar.xz', '.txz'].some(ext => file.name.toLowerCase().endsWith(ext));

const downloadFile = (file) => window.open(`/api/instances/${fmStore.currentInstanceId}/download/${encodeURIComponent(file.path)}`, '_blank');

const openCreateNew = (type) => {
    newType.value = type;
    uiStore.openModal('createNewFile');
};
const openRename = (file) => {
    selectedFile.value = file;
    uiStore.openModal('renameFile');
};
const openExtract = (file) => {
    selectedFile.value = file;
    uiStore.openModal('extractFile');
};
const openEditor = (file) => {
    selectedFile.value = file;
    uiStore.openModal('fileEditor');
};

const openDelete = (file) => {
    deleteTarget.value = { 
        type: 'single',
        title: 'Confirm File Deletion',
        message: 'Are you sure you want to permanently delete this file?',
        name: file.name,
        path: file.path
    };
    uiStore.openModal('confirmDelete');
};

const openDeleteSelectedConfirm = () => {
    deleteTarget.value = {
        type: 'multiple',
        title: 'Confirm Multiple Deletions',
        message: `Are you sure you want to permanently delete these ${fmStore.selectedFiles.size} items?`,
        name: '',
        paths: Array.from(fmStore.selectedFiles)
    };
    uiStore.openModal('confirmDelete');
};

const confirmDelete = () => {
    if (deleteTarget.value.type === 'single') {
        fmStore.deleteFile(deleteTarget.value.path);
    } else if (deleteTarget.value.type === 'multiple') {
        fmStore.deleteMultiple(deleteTarget.value.paths);
    }
};

</script>

<style scoped>
#file-browser {
    height: calc(100vh - 200px);
    overflow-y: auto;
}
.file-row { cursor: pointer; }
.file-actions .btn {
    padding: 0.1rem 0.4rem;
    font-size: 0.8rem;
}
</style>