<template>
  <div class="d-flex">
    <Sidebar />
    <main id="main-content">
      <AppHeader :page-title="instance?.name || $t('loading')" />

      <div v-if="instance">
        <!-- Instance Header & Actions -->
        <div class="d-flex justify-content-between align-items-center pb-2 mb-3 border-bottom flex-wrap">
          <div class="d-flex align-items-center me-3 mb-2 mb-md-0">
            <span class="badge bg-secondary" id="instance-stats-badge">
              {{ $t('instances.detail.cpu') }}{{ stats.cpu || '--' }}{{ $t('instances.detail.mem') }}{{ stats.memory || '--' }}{{ $t('instances.detail.mb') }}
            </span>
          </div>
          
          <div class="d-flex align-items-center">
            <div v-if="instance && instance.type === 'docker_compose' && instance.status === 'running'" class="me-3" style="min-width: 200px;">
               <div class="input-group input-group-sm">
                  <span class="input-group-text"><i class="bi bi-box-seam"></i></span>
                  <select class="form-select" v-model="selectedContainer" @change="switchContainer">
                      <option v-for="c in composeContainers" :key="c.id" :value="c.name">{{ c.name }}</option>
                  </select>
               </div>
            </div>

            <div v-if="canOperate" class="btn-toolbar">
              <!-- Action Buttons -->
               <div class="btn-group me-2">
                  <button class="btn btn-success" @click="performAction('start')" :disabled="instance.status === 'running'">
                      <i class="bi bi-play-fill me-1"></i><span>{{ $t('instances.start') }}</span>
                  </button>
                  <div class="btn-group">
                      <button type="button" class="btn btn-danger dropdown-toggle" data-bs-toggle="dropdown" :disabled="instance.status !== 'running'">
                          <i class="bi bi-stop-fill me-1"></i><span>{{ $t('instances.stop') }}</span>
                      </button>
                      <ul class="dropdown-menu">
                          <li><a class="dropdown-item" href="#" @click.prevent="performAction('stop')">{{ $t('instances.stop.stop') }}</a></li>
                          <li><a class="dropdown-item" href="#" @click.prevent="performAction('terminate')">{{ $t('instances.stop.terminate') }}</a></li>
                      </ul>
                  </div>
              </div>
              <div class="btn-group me-2">
                   <div class="btn-group">
                      <button type="button" class="btn btn-warning dropdown-toggle" data-bs-toggle="dropdown" :disabled="instance.status !== 'running'">
                         <i class="bi bi-arrow-clockwise me-1"></i><span>{{ $t('instances.restart') }}</span>
                      </button>
                      <ul class="dropdown-menu">
                          <li><a class="dropdown-item" href="#" @click.prevent="performAction('restart')">{{ $t('instances.restart') }}</a></li>
                          <li><a class="dropdown-item" href="#" @click.prevent="performAction('force-restart')">{{ $t('instances.restart.force') }}</a></li>
                      </ul>
                  </div>
              </div>
              <div class="btn-group" v-if="canFullControl">
                <button class="btn btn-secondary" @click="openSettings">
                  <i class="bi bi-gear-fill"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Terminal Area -->
        <div id="terminal-container">
            <Terminal 
                ref="terminalRef"
                :key="instance.id + '-' + instance.status"
                :instance-id="instance.id" 
                :is-read-only="instance.status !== 'running' || isTerminalReadOnly" 
                @has-content="hasTerminalContent = true"
                class="h-100 w-100"
            />
            <div v-if="instance.status !== 'running' && !hasTerminalContent" class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-dark" style="z-index: 10;">
                <div class="text-center">
                    <p class="fs-4 text-light">{{ $t('instances.stopped.hint') }}</p>
                    <button v-if="canOperate" class="btn btn-success mt-3" @click="performAction('start')">
                        {{ $t('instances.start') }}
                    </button>
                </div>
            </div>
        </div>
      </div>
      <div v-else class="text-center p-5">
        <h2>{{ $t('instances.not_found.title') }}</h2>
        <p>{{ $t('instances.not_found.message') }}</p>
        <router-link to="/" class="btn btn-primary">{{ $t('instances.back_to_dashboard') }}</router-link>
      </div>
    </main>
  </div>
  <InstanceSettingsModal v-if="uiStore.modals.instanceSettings" :instance="instance" />
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useInstancesStore } from '../stores/instances';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import { useWebSocketStore } from '../stores/websocket';
import Sidebar from '../components/Sidebar.vue';
import AppHeader from '../components/AppHeader.vue';
import Terminal from '../components/Terminal.vue';
import InstanceSettingsModal from '../components/modals/InstanceSettingsModal.vue';
import api from '../services/api';

const route = useRoute();
const instancesStore = useInstancesStore();
const sessionStore = useSessionStore();
const uiStore = useUiStore();
const websocketStore = useWebSocketStore();

const instanceId = ref(route.params.id);
const terminalRef = ref(null);
const hasTerminalContent = ref(false);
const composeContainers = ref([]);
const selectedContainer = ref('');

const instance = computed(() => instancesStore.getInstanceById(instanceId.value));
const stats = computed(() => instancesStore.instanceStats[instanceId.value] || {});

const userPermission = computed(() => {
    const user = sessionStore.currentUser;
    if (!user || !instance.value) return null;
    if (user.role === 'admin') return 'full-control';
    return instance.value.permissions?.[user.id]?.terminal ?? null;
});

const canOperate = computed(() => ['read-write-ops', 'full-control'].includes(userPermission.value));
const canFullControl = computed(() => userPermission.value === 'full-control');
const isTerminalReadOnly = computed(() => userPermission.value === 'read-only');

const fetchComposeContainers = async () => {
    if (instance.value?.type !== 'docker_compose' || instance.value?.status !== 'running') return;
    try {
        const containers = await api.getComposeContainers(instanceId.value);
        composeContainers.value = containers;
        if (containers.length > 0 && !selectedContainer.value) {
            selectedContainer.value = containers[0].name;
        }
    } catch (e) {
        console.error(e);
    }
};

const switchContainer = () => {
    if (!selectedContainer.value) return;
    websocketStore.sendMessage({
        type: 'switch-container',
        id: instanceId.value,
        containerName: selectedContainer.value
    });
    nextTick(() => terminalRef.value?.triggerResize());
};

onMounted(() => {
    // If instances are not loaded yet, fetch them
    if (instancesStore.instances.length === 0) {
        instancesStore.fetchInstances();
    }
    if (instance.value?.type === 'docker_compose' && instance.value?.status === 'running') {
        fetchComposeContainers();
    }
});

// Watch for route changes if the user navigates between instances
watch(() => route.params.id, (newId) => {
    instanceId.value = newId;
    hasTerminalContent.value = false;
    composeContainers.value = [];
    selectedContainer.value = '';
    if (instance.value?.type === 'docker_compose' && instance.value?.status === 'running') {
        fetchComposeContainers();
    }
});

watch(() => instance.value?.status, (newStatus) => {
    hasTerminalContent.value = false;
    if (newStatus === 'running') {
        if (instance.value?.type === 'docker_compose') {
            fetchComposeContainers();
        }
        nextTick(() => {
            terminalRef.value?.triggerResize();
        });
    } else {
        composeContainers.value = [];
        selectedContainer.value = '';
    }
});

function performAction(action) {
    instancesStore.performAction(instanceId.value, action);
}

function openSettings() {
    uiStore.openModal('instanceSettings');
}
</script>

<style scoped>
#terminal-container {
    width: 100%;
    height: calc(100vh - 155px);
    background-color: #000;
    padding:  5px 10px;
    border-radius: 5px;
    overflow: hidden;
    position: relative;
}
</style>