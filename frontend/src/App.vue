<template>
  <div id="app-container" :class="{ 'has-background': uiStore.panelBackground !== '' }">
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
    <ToastContainer />
    <ChangePasswordModal v-if="uiStore.modals.changePassword" :user="uiStore.selectedUserForPasswordChange" />
    <PanelSettingsModal v-if="uiStore.modals.panelSettings" />
  </div>
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

import api from './services/api'; // 导入 api 服务

const websocketStore = useWebSocketStore();
const sessionStore = useSessionStore();
const uiStore = useUiStore();
const instancesStore = useInstancesStore(); // 初始化 instances store
const route = useRoute(); // 初始化 route
const { t, waitTranslationLoad } = useI18n();

// App 启动时，检查会话并初始化 WebSocket
onMounted(async () => {
  const isAuthenticated = await sessionStore.checkSession();
  if (isAuthenticated) {
    websocketStore.connect();
  }
  await uiStore.fetchPublicPanelSettings();
  try {
    const backgroundResponse = await api.getBackgroundImage();
    if (backgroundResponse.ok) {
      uiStore.updatePanelBackground('/api/panel-settings/background');
    }
  } catch (error) { }
});

watch(
  () => uiStore.panelBackground,
  (background) => {
    document.body.classList.toggle('has-panel-background', Boolean(background));
    if (background) {
      document.body.style.setProperty('--panel-background-image', `url(${background})`);
    } else {
      document.body.style.removeProperty('--panel-background-image');
    }
  },
  { immediate: true }
);

// 监听路由变化以更新页面标题
watch(
  () => route.fullPath,
  async () => {
    await waitTranslationLoad();
    let title = t('panel.name');
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

<style>
#app-container {
  min-height: 100vh;
  min-height: 100dvh;
  background-color: var(--bs-body-bg);
  transition: background-color 0.5s ease-in-out;
}

body.has-panel-background {
  background-image: var(--panel-background-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}

#app-container.has-background {
  background-color: transparent !important;
}

.bg-body-tertiary-transparent {
  background-color: rgba(var(--bs-body-bg-rgb), 0.8) !important; /* 80% opacity */
}

/* Example of making components semi-transparent */
/* You might need to apply this to specific components or a global overlay */
.modal-content,
.card,
.bg-body-tertiary {
  background-color: var(--bs-body-bg) !important;
  /* Ensure components use theme background */
  transition: background-color 0.5s ease-in-out;
}

/* Terminal transparency - adjust as needed */
.xterm .xterm-viewport {
  background-color: rgba(0, 0, 0, 0.6) !important;
  /* 60% transparency for terminal */
}
</style>
