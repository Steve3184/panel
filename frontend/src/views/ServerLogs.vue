<template>
  <div class="d-flex">
    <Sidebar />
    <main id="main-content">
      <AppHeader :page-title="t('title.logs')" />
      
      <div class="container-fluid py-3 flex-grow-1 d-flex flex-column" style="height: calc(100vh - 100px);">
        <!-- Header Row -->
        <div class="d-flex justify-content-between align-items-center mb-3 flex-shrink-0">
          <div class="bg-body-tertiary rounded px-3 py-2">
            <h5 class="mb-0 text-secondary" style="font-size: 1rem;">
              <i class="bi bi-file-earmark-text me-2"></i>{{ currentLogFile }}
            </h5>
          </div>
          
          <div class="dropdown">
            <button class="btn btn-link text-decoration-none bg-body-tertiary rounded px-3 py-2 dropdown-toggle no-arrow text-secondary" type="button" id="logDateDropdown" data-bs-toggle="dropdown" aria-expanded="false" :title="t('logs.select_date')">
              <i class="bi bi-clock-history"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="logDateDropdown" style="max-height: 300px; overflow-y: auto;">
              <li v-for="file in logFiles" :key="file">
                <a class="dropdown-item" href="#" @click.prevent="fetchLogContent(file)" :class="{ active: currentLogFile === file }">
                  {{ file }}
                </a>
              </li>
              <li v-if="logFiles.length === 0"><span class="dropdown-item disabled">{{ t('logs.no_logs') }}</span></li>
            </ul>
          </div>
        </div>

        <!-- Log Content Card -->
        <div class="card shadow-sm flex-grow-1 border-0" style="overflow: hidden;">
          <div class="card-body p-0 h-100 bg-dark rounded position-relative">
             <div ref="logContainerRef" class="h-100 w-100 overflow-auto p-3 font-monospace text-light" style="font-size: 0.85rem;">
                <div v-if="logLines.length > 0">
                    <div v-for="(line, index) in logLines" :key="index" :class="line.class" style="white-space: pre;">{{ line.text }}</div>
                </div>
                <div v-else class="text-muted">{{ t('logs.loading') }}</div>
             </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue';
import Sidebar from '../components/Sidebar.vue';
import AppHeader from '../components/AppHeader.vue';
import api from '../services/api';
import { useI18n } from '../composables/useI18n';

const { t } = useI18n();
const logFiles = ref([]);
const currentLogFile = ref('');
const logContent = ref('');
const logContainerRef = ref(null);

const fetchLogFiles = async () => {
  try {
    const files = await api.getLogs();
    logFiles.value = files;
    if (files.length > 0) {
      // Default to the first (latest) log file
      fetchLogContent(files[0]);
    } else {
      logContent.value = t('logs.no_logs_found');
    }
  } catch (error) {
    console.error('Failed to fetch log files:', error);
    logContent.value = t('logs.failed_to_load_list');
  }
};

const fetchLogContent = async (filename) => {
  currentLogFile.value = filename;
  logContent.value = ''; // Clear content to show loading state or similar if needed
  try {
    const response = await api.getLogContent(filename);
    // The content comes as { content: "..." }
    logContent.value = response.content;
  } catch (error) {
    console.error(`Failed to fetch content for ${filename}:`, error);
    logContent.value = t('logs.failed_to_load_content');
  }
};

const logLines = computed(() => {
    if (!logContent.value) return [];
    return logContent.value.split('\n').map(text => {
        let cssClass = '';
        if (text.includes('[ERROR]')) cssClass = 'text-danger';
        else if (text.includes('[WARN]')) cssClass = 'text-warning';
        else if (text.includes('[INFO]')) cssClass = 'text-info';
        else if (text.includes('[DEBUG]')) cssClass = 'text-secondary';
        
        return { text, class: cssClass };
    });
});

const scrollToBottom = async () => {
    await nextTick();
    if (logContainerRef.value) {
        logContainerRef.value.scrollTop = logContainerRef.value.scrollHeight;
    }
};

watch(logContent, scrollToBottom);

onMounted(() => {
  fetchLogFiles();
});
</script>

<style scoped>
.dropdown-toggle.no-arrow::after {
  display: none;
}
</style>
