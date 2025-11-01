<template>
  <div class="d-flex">
    <Sidebar />
    <main id="main-content">
      <AppHeader :page-title="$t('title.files')" />
      
      <!-- The main File Browser component -->
      <FileBrowser />

    </main>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useFileManagerStore } from '../stores/fileManager';
import Sidebar from '../components/Sidebar.vue';
import AppHeader from '../components/AppHeader.vue';
import FileBrowser from '../components/FileManager/FileBrowser.vue';

const fileManagerStore = useFileManagerStore();

// When the view is mounted, ensure the file manager state is reset
// in case the user navigates away and comes back without a full refresh.
onMounted(() => {
  // If no instance is selected, the FileBrowser component will show the instance selector.
  // We can also reset the state here if needed.
  // fileManagerStore.currentInstanceId = null; 
});
</script>