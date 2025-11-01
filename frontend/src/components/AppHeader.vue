<template>
  <div class="d-flex justify-content-between align-items-center mb-3">
    <div class="d-flex align-items-center">
      <button class="btn btn-dark me-2" @click="uiStore.toggleSidebar">
        <i class="bi bi-list"></i>
      </button>
      <h1 class="h2 mb-0">{{ pageTitle }}</h1>
    </div>
    <div class="dropdown" v-if="sessionStore.currentUser">
      <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
        <span>{{ $t('panel.welcome', { username: sessionStore.currentUser.username }) }}</span>
      </button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li>
          <a class="dropdown-item" href="#" @click.prevent="openChangePassword">
            {{ $t('users.change_password') }}
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
import { ref } from 'vue';
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
</script>