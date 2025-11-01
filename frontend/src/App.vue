<template>
  <RouterView v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>
  <ToastContainer />
  <ChangePasswordModal v-if="uiStore.modals.changePassword" :user="uiStore.selectedUserForPasswordChange" />
  <PanelSettingsModal v-if="uiStore.modals.panelSettings" :isVisible="uiStore.modals.panelSettings" :initialSettings="uiStore.panelSettings" @update:isVisible="uiStore.modals.panelSettings = $event" @save="handleSavePanelSettings" />
</template>

<script setup>
import { onMounted, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { useWebSocketStore } from './stores/websocket';
import { useSessionStore } from './stores/session';
import { useUiStore } from './stores/ui';
import { useInstancesStore } from './stores/instances'; // 导入 instances store
import ToastContainer from './components/ToastContainer.vue';
import ChangePasswordModal from './components/modals/ChangePasswordModal.vue';
import PanelSettingsModal from './components/modals/PanelSettingsModal.vue'; // 导入 PanelSettingsModal
import { useI18n } from './composables/useI18n';

const websocketStore = useWebSocketStore();
const sessionStore = useSessionStore();
const uiStore = useUiStore();
const instancesStore = useInstancesStore(); // 初始化 instances store
const route = useRoute(); // 初始化 route
const { t } = useI18n();

import api from './services/api'; // 导入 api 服务

const handleSavePanelSettings = async (settings) => {
  try {
    await api.updatePanelSettings(settings);
    uiStore.panelSettings = settings; // 更新全局设置
    uiStore.showToast('面板设置已保存', 'success');
  } catch (error) {
    uiStore.showToast(`保存面板设置失败: ${error.message}`, 'danger');
  }
};

// App 启动时，检查会话并初始化 WebSocket
onMounted(async () => {
  const isAuthenticated = await sessionStore.checkSession();
  if (isAuthenticated) {
    websocketStore.connect();
    // 获取面板设置
    try {
      const response = await api.getPanelSettings();
      uiStore.panelSettings = response.settings; // 存储到 uiStore
    } catch (error) {
      console.error('Failed to fetch panel settings:', error);
    }
  }
});

// 监听路由变化以更新页面标题
watch(
  () => route.fullPath,
  async () => {
    let title = t('panel.name'); // 默认标题
    let pageName = '';

    switch (route.name) {
      case 'Dashboard':
        pageName = t('title.overview');
        break;
      case 'FileManager':
        pageName = t('title.files');
        if (route.query.instanceId) {
          await instancesStore.fetchInstances(); // 确保实例数据已加载
          const instance = instancesStore.getInstanceById(route.query.instanceId);
          if (instance) {
            pageName += ` - ${instance.name}`;
          }
        }
        break;
      case 'InstanceDetail':
        pageName = ''; // 实例详情页的标题完全由实例名决定
        if (route.params.id) {
          await instancesStore.fetchInstances(); // 确保实例数据已加载
          const instance = instancesStore.getInstanceById(route.params.id);
          if (instance) {
            pageName = `${instance.name}`;
          }
        }
        break;
      case 'UserManagement':
        pageName = t('title.users');
        break;
      case 'Login':
        pageName = t('login.title');
        break;
      case 'Setup':
        pageName = t('setup.title');
        break;
      case 'NotFound':
        pageName = '404';
        break;
      default:
        pageName = '';
    }

    if (pageName) {
      document.title = `${pageName} - ${title}`;
    } else {
      document.title = title;
    }
  },
  { immediate: true } // 立即执行一次，以便在初始加载时设置标题
);
</script>