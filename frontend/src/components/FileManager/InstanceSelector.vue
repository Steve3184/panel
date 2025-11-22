<template>
  <div class="mb-3" id="instance-selector">
    <h5>{{ t('files.instance.select') }}</h5>
    <div v-if="instancesStore.instances.length === 0" class="text-muted text-center p-4">
      {{ t('files.instance.no_available') }}
    </div>
    <div v-else class="list-group">
      <a v-for="instance in instancesStore.instances" :key="instance.id" href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" @click.prevent="selectInstance(instance.id)">
        <div class="d-flex align-items-center">
          <i class="bi bi-server me-2"></i> {{ instance.name }}
        </div>
        <div class="d-flex align-items-center">
          <button class="btn me-2" style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .75rem;" @click.stop="copyWebDAVLink(instance.id)" :title="t('files.copy_webdav_link')">
            <i class="bi bi-link-45deg"></i>
          </button>
          <span :class="['badge', instance.status === 'running' ? 'bg-success' : 'bg-secondary']">
            {{ $t(instance.status === 'running' ? 'instances.status.running': 'instances.status.stopped') }}
          </span>
        </div>
      </a>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useInstancesStore } from '../../stores/instances';
import { useFileManagerStore } from '../../stores/fileManager';
import { useI18n } from '../../composables/useI18n';
import { useUiStore } from '../../stores/ui';

const { t } = useI18n();
const uiStore = useUiStore();
const instancesStore = useInstancesStore();
const fileManagerStore = useFileManagerStore();

onMounted(() => {
    if (instancesStore.instances.length === 0) {
        instancesStore.fetchInstances();
    }
});

const selectInstance = (id) => {
  fileManagerStore.selectInstance(id);
};

const copyWebDAVLink = async (instanceId) => {
  const webdavLink = `${window.location.origin}/api/dav/${instanceId}/`;
  try {
    // 使用Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(webdavLink);
      uiStore.showToast(t('files.copy_webdav_link_success'), 'success');
    } else {
      // 备用方案，适用于非安全上下文
      const textArea = document.createElement('textarea');
      textArea.value = webdavLink;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      new Promise((res, rej) => {
        document.execCommand('copy') ? res() : rej();
        textArea.remove();
      });
      uiStore.showToast(t('files.copy_webdav_link_success'), 'success');
    }
  } catch (err) {
    console.error('Failed to copy WebDAV link: ', err);
    uiStore.showToast(t('files.copy_webdav_link_failed'), 'danger');
  }
};
</script>

<style scoped>
#instance-selector {
    height: calc(100vh - 100px);
    overflow-y: auto;
}
</style>