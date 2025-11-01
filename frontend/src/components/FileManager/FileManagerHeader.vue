<template>
  <div class="pb-2 mb-3 border-bottom">
    <div class="d-flex justify-content-between align-items-center flex-wrap">
      <!-- Left Side -->
      <div class="d-flex align-items-center me-3 mb-2 mb-md-0">
        <button class="btn btn-secondary me-2" @click="goBack" :title="t('files.header.back_to_instances')">
          <i class="bi bi-arrow-left"></i>
        </button>
        <nav aria-label="breadcrumb">
          <ol class="breadcrumb mb-0 flex-nowrap overflow-auto">
            <li class="breadcrumb-item text-nowrap">
              <a href="#" @click.prevent="navigateToPath('')">{{ t('files.home') }}</a>
            </li>
            <li v-for="(part, index) in pathParts" :key="index" class="breadcrumb-item text-nowrap">
              <a href="#" @click.prevent="navigateToPath(getPathByIndex(index))">{{ truncateFolderName(part) }}</a>
            </li>
          </ol>
        </nav>
      </div>

      <!-- Right Side -->
      <div class="d-flex align-items-center flex-grow-1 justify-content-end">
        <!-- Search Input -->
        <div class="input-group me-2" style="max-width: 300px;">
          <input type="text" class="form-control" :placeholder="t('files.header.search_files')" v-model="searchQuery">
          <button class="btn btn-outline-secondary" type="button" @click="searchQuery = ''" v-if="searchQuery">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <!-- Selection Actions -->
        <div class="dropdown me-2" v-if="fmStore.selectedFiles.size > 0">
            <button class="btn btn-info dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" :title="t('files.header.selection_actions')">
                <i class="bi bi-check-square"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="#" @click.prevent="copySelected"><i class="bi bi-clipboard-fill me-2"></i>{{ t('files.header.copy') }}</a></li>
                <li><a class="dropdown-item" href="#" @click.prevent="cutSelected"><i class="bi bi-scissors me-2"></i>{{ t('files.header.cut') }}</a></li>
                <li><a class="dropdown-item" href="#" @click.prevent="uiStore.openModal('compressFiles')"><i class="bi bi-box-arrow-in-down-right me-2"></i>{{ t('files.header.compress') }}</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-danger" href="#" @click.prevent="emit('delete-selected')"><i class="bi bi-trash-fill me-2"></i>{{ t('files.header.delete_selected') }}</a></li>
            </ul>
        </div>

        <!-- Paste Button -->
        <button class="btn btn-warning me-2" v-if="fmStore.clipboard.operation" @click.prevent="paste" :title="t('files.header.paste')">
            <i class="bi bi-clipboard-check-fill"></i>
        </button>

        <!-- Upload and New Buttons -->
        <button class="btn btn-primary me-2" @click="uiStore.openModal('uploadFile')" :title="t('files.header.upload_file')">
          <i class="bi bi-cloud-arrow-up-fill"></i>
        </button>
        <div class="dropdown">
            <button class="btn btn-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" :title="t('files.header.new')">
                <i class="bi bi-plus-lg"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="#" @click.prevent="emit('create', 'folder')"><i class="bi bi-folder-plus me-2"></i>{{ t('files.header.new_folder') }}</a></li>
                <li><a class="dropdown-item" href="#" @click.prevent="emit('create', 'file')"><i class="bi bi-file-earmark-plus me-2"></i>{{ t('files.header.new_file') }}</a></li>
            </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useFileManagerStore } from '../../stores/fileManager';
import { useUiStore } from '../../stores/ui';
import { useI18n } from '../../composables/useI18n';

const fmStore = useFileManagerStore();
const uiStore = useUiStore();
const { t } = useI18n();
const emit = defineEmits(['create', 'delete-selected', 'update:searchQuery']);

const searchQuery = ref('');

watch(searchQuery, (newVal) => {
  emit('update:searchQuery', newVal);
});

const truncateFolderName = (folderName, maxLength = 8) => {
  if (folderName.length > maxLength) {
    return folderName.substring(0, maxLength - 3) + '...';
  }
  return folderName;
};

const pathParts = computed(() => fmStore.currentPath ? fmStore.currentPath.split('/').filter(p => p) : []);

const goBack = () => {
    fmStore.currentInstanceId = null;
    fmStore.selectedFiles.clear();
    fmStore.clipboard.operation = null;
};

const navigateToPath = (path) => fmStore.loadFiles(path);
const getPathByIndex = (index) => pathParts.value.slice(0, index + 1).join('/');

const copySelected = () => {
    fmStore.clipboard.operation = 'copy';
    fmStore.clipboard.files = Array.from(fmStore.selectedFiles);
    fmStore.selectedFiles.clear();
    uiStore.showToast(t('files.header.copied_items', { count: fmStore.clipboard.files.length }), 'info');
};

const cutSelected = () => {
    fmStore.clipboard.operation = 'cut';
    fmStore.clipboard.files = Array.from(fmStore.selectedFiles);
    fmStore.selectedFiles.clear();
    uiStore.showToast(t('files.header.cut_items', { count: fmStore.clipboard.files.length }), 'info');
};

const paste = () => {
    if (fmStore.clipboard.operation === 'copy') {
        fmStore.copy(fmStore.currentPath);
    } else if (fmStore.clipboard.operation === 'cut') {
        fmStore.move(fmStore.currentPath);
    }
    fmStore.clipboard.operation = null;
};
</script>