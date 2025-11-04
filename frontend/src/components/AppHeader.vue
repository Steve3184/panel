<template>
  <div class="d-flex justify-content-between align-items-center mb-3">
    <div class="d-flex align-items-center">
      <button class="btn me-2" :class="sidebarToggleClass" @click="uiStore.toggleSidebar">
        <i class="bi bi-list"></i>
      </button>
      <h1 class="h2 mb-0 text-body">{{ pageTitle }}</h1>
    </div>
    <div class="dropdown" v-if="sessionStore.currentUser">
      <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
        <span>{{ $t('panel.greeting', { username: sessionStore.currentUser.username }) }}</span>
      </button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li>
          <a class="dropdown-item" href="#" @click.prevent="openChangePassword">
            {{ $t('users.change_password') }}
          </a>
        </li>
        <li>
          <a class="dropdown-item" href="#" @click.prevent="toggleThemeMode">
            {{ $t('panelSettings.themeMode') }} ({{ $t(`themeMode.${uiStore.themeMode}`) }})
          </a>
        </li>
        <li>
          <a class="dropdown-item" href="#" @click.prevent="uiStore.openModal('changeLanguage')">
            {{ $t('panel.change_language') }}
          </a>
        </li>
        <li><hr class="dropdown-divider"></li>
        <li><a class="dropdown-item" href="#" @click.prevent="sessionStore.logout">{{ $t('panel.logout') }}</a></li>
      </ul>
    </div>
  </div>

  <!-- These modals are triggered from the header but are globally available -->
  <ChangeLanguageModal v-if="uiStore.modals.changeLanguage" />
</template>

<script setup>
import { ref, computed } from 'vue';
import { useUiStore } from '../stores/ui';
import { useSessionStore } from '../stores/session';
import ChangeLanguageModal from './modals/ChangeLanguageModal.vue';

defineProps({
  pageTitle: {
    type: String,
    required: true
  }
});

const uiStore = useUiStore();
const sessionStore = useSessionStore();

const userForPasswordChange = ref(null);

function openChangePassword() {
    uiStore.selectedUserForPasswordChange = sessionStore.currentUser;
    uiStore.openModal('changePassword');
}

function toggleThemeMode() {
  const currentMode = uiStore.themeMode;
  let newMode;
  if (currentMode === 'light') {
    newMode = 'dark';
  } else if (currentMode === 'dark') {
    newMode = 'auto';
  } else {
    newMode = 'light';
  }
  uiStore.setThemeMode(newMode);
}
const sidebarToggleClass = computed(() => {
  if (uiStore.themeMode === 'dark') {
    return 'btn-dark';
  } else if (uiStore.themeMode === 'light') {
    return 'btn-light';
  } else { // auto mode
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'btn-light';
    }
    return 'btn-dark';
  }
});
</script>