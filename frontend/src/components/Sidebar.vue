<template>
    <nav class="sidebar p-3" :class="{ 'collapsed': uiStore.isSidebarCollapsed, 'bg-body-tertiary': uiStore.panelBackground === '', 'bg-body-tertiary-transparent': uiStore.panelBackground !== '' }">
        <!-- Header -->
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h4 class="mb-0">
                <img v-if="uiStore.panelLogo != ''" :src="uiStore.panelLogo" alt="Logo" class="sidebar-logo me-2" />
                <i v-else class="bi bi-server me-2"></i>
                <span>{{ t('panel.name') }}</span>
            </h4>
            <button class="btn btn-dark d-block d-md-none" @click="uiStore.toggleSidebar">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>
        <!-- Main Nav -->
        <ul class="nav flex-column">
            <li class="nav-item">
                <router-link to="/" class="nav-link" active-class="active">
                    <i class="bi bi-grid-1x2-fill me-2"></i><span>{{ t('title.overview') }}</span>
                </router-link>
            </li>
            <li class="nav-item">
                 <router-link to="/files" class="nav-link" active-class="active">
                    <i class="bi bi-folder-fill me-2"></i><span>{{ t('title.files') }}</span>
                </router-link>
            </li>
            <li class="nav-item" v-if="sessionStore.currentUser?.role === 'admin'">
                <router-link to="/users" class="nav-link" active-class="active">
                    <i class="bi bi-people-fill me-2"></i><span>{{ t('title.users') }}</span>
                </router-link>
            </li>
            <li class="nav-item" v-if="sessionStore.currentUser?.role === 'admin'">
                <a href="#" class="nav-link" @click.prevent="openPanelSettings">
                    <i class="bi bi-gear-fill me-2"></i><span>{{ t('panelSettings.title') }}</span>
                </a>
            </li>
        </ul>
        <hr>
        <!-- Instances List -->
        <h6 class="px-3">{{ t('instances') }}</h6>
        <ul class="nav flex-column mb-2 overflow-y-auto flex-nowrap" id="instance-list-sidebar">
             <li class="nav-item" v-for="instance in instancesStore.instances" :key="instance.id">
                <router-link :to="`/instance/${instance.id}`" class="nav-link d-flex justify-content-between align-items-center" active-class="active">
                    <span>
                        <i :class="['me-2', instance.type === 'docker' ? 'bi bi-box-seam' : 'bi bi-terminal']"></i>
                        {{ instance.name }}
                    </span>
                    <span :class="['badge', instance.status === 'running' ? 'bg-success' : 'bg-secondary']">
                        {{ instance.status === 'running' ? t('instances.status.running') : t('instances.status.stopped') }}
                    </span>
                </router-link>
            </li>
        </ul>
    </nav>
</template>

<script setup>
import { useUiStore } from '../stores/ui';
import { useInstancesStore } from '../stores/instances';
import { useSessionStore } from '../stores/session';
import { useI18n } from '../composables/useI18n';

const uiStore = useUiStore();
const instancesStore = useInstancesStore();
const sessionStore = useSessionStore();
const { t } = useI18n();

const openPanelSettings = () => {
  uiStore.openModal('panelSettings')
};
</script>