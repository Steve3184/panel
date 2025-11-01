<template>
  <div id="toast-container" class="toast-container position-fixed top-0 end-0 p-3" style="z-index: 1100;">
    <transition-group name="toast">
      <div v-for="toast in uiStore.toasts" :key="toast.id" :class="['toast', 'align-items-center', `text-bg-${toast.type}`, 'border-0', 'show']" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body flex-grow-1 text-white">
            {{ $t(toast.message) }}
            <div v-if="toast.progress !== undefined" class="progress mt-2" style="height: 5px;">
              <div class="progress-bar bg-white" role="progressbar" :style="{ width: toast.progress + '%' }" :aria-valuenow="toast.progress" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" @click="uiStore.removeToast(toast.id)" aria-label="Close"></button>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useUiStore } from '../stores/ui';
import { useI18n } from '../composables/useI18n';

const uiStore = useUiStore();
const { t } = useI18n();
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.5s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>