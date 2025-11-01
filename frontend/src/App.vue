<template>
  <RouterView />
  <ToastContainer />
  <ChangePasswordModal v-if="uiStore.modals.changePassword" :user="uiStore.selectedUserForPasswordChange" />
</template>

<script setup>
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useWebSocketStore } from './stores/websocket';
import { useSessionStore } from './stores/session';
import { useUiStore } from './stores/ui';
import ToastContainer from './components/ToastContainer.vue';
import ChangePasswordModal from './components/modals/ChangePasswordModal.vue';

const websocketStore = useWebSocketStore();
const sessionStore = useSessionStore();
const uiStore = useUiStore();

// App 启动时，检查会话并初始化 WebSocket
onMounted(async () => {
  const isAuthenticated = await sessionStore.checkSession();
  if (isAuthenticated) {
    websocketStore.connect();
  }
});
</script>