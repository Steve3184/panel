<template>
  <div class="d-flex">
    <Sidebar />
    <main id="main-content">
      <AppHeader :page-title="$t('title.overview')" />
      
      <!-- Page Content - Overview Only -->
      <div id="overview-page">
        <!-- System Stats -->
        <div class="row mb-4">
          <div class="col-lg-6 mb-3">
            <StatCard :title="$t('overview.cpu_usage')" :value="`${instancesStore.systemStats.cpu}%`" />
          </div>
          <div class="col-lg-6 mb-3">
            <StatCard :title="$t('overview.memory_usage')" :value="`${instancesStore.systemStats.mem}/${instancesStore.systemStats.totalMem} GB`" />
          </div>
        </div>

        <!-- Instance List Actions -->
        <div class="d-flex mb-3">
          <input type="text" class="form-control me-2" v-model="searchTerm" :placeholder="$t('instances.search.placeholder')">
          <button v-if="sessionStore.currentUser?.role === 'admin'" class="btn btn-primary flex-shrink-0" @click="uiStore.openModal('createInstance')">
            <i class="bi bi-plus-lg me-2"></i><span>{{ $t('instances.create') }}</span>
          </button>
        </div>

        <!-- Instance List -->
        <div id="instance-list-overview">
            <div v-for="instance in filteredInstances" :key="instance.id" class="card mb-3">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center flex-wrap">
                        <div class="me-3 mb-2 mb-md-0">
                            <h5 class="card-title mb-1">
                                <i :class="['me-2', instance.type === 'docker' ? 'bi bi-box-seam' : 'bi bi-terminal']"></i>
                                {{ instance.name }}
                            </h5>
                            <span :class="['badge me-2', instance.status === 'running' ? 'bg-success' : 'bg-secondary']">
                                {{ instance.status === 'running' ? $t('instances.status.running') : $t('instances.status.stopped') }}
                            </span>
                            <small class="text-muted"><code>{{ instance.type === 'docker' ? instance.dockerConfig?.image || instance.command : instance.command }}</code></small>
                        </div>
                        <div class="btn-group">
                            <router-link :to="`/instance/${instance.id}`" class="btn btn-sm btn-outline-primary">{{ $t('open') }}</router-link>
                             <button v-if="canManage(instance)" class="btn btn-sm btn-outline-secondary" @click="openSettings(instance)">
                                <i class="bi bi-gear"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
             <p v-if="filteredInstances.length === 0" class="text-muted">{{ $t('files.instance.no_instances_found') }}</p>
        </div>
      </div>
    </main>
  </div>
  
  <!-- Modals -->
  <CreateInstanceModal v-if="uiStore.modals.createInstance" />
  <InstanceSettingsModal v-if="uiStore.modals.instanceSettings" :instance="selectedInstance" />

</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useInstancesStore } from '../stores/instances';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import Sidebar from '../components/Sidebar.vue';
import AppHeader from '../components/AppHeader.vue';
import StatCard from '../components/StatCard.vue';
import CreateInstanceModal from '../components/modals/CreateInstanceModal.vue';
import InstanceSettingsModal from '../components/modals/InstanceSettingsModal.vue';

const instancesStore = useInstancesStore();
const sessionStore = useSessionStore();
const uiStore = useUiStore();

const searchTerm = ref('');
const selectedInstance = ref(null);

onMounted(() => {
  instancesStore.fetchInstances();
});

const filteredInstances = computed(() => {
  if (!searchTerm.value) {
    return instancesStore.instances;
  }
  const term = searchTerm.value.toLowerCase();
  return instancesStore.instances.filter(instance =>
    instance.name.toLowerCase().includes(term) ||
    instance.command.toLowerCase().includes(term) ||
    (instance.type === 'docker' && instance.dockerConfig?.image.toLowerCase().includes(term))
  );
});

const canManage = (instance) => {
    const user = sessionStore.currentUser;
    if (!user) return false;
    if (user.role === 'admin') return true;
    const perms = instance.permissions?.[user.id];
    return perms?.terminal === 'full-control';
};

const openSettings = (instance) => {
    selectedInstance.value = instance;
    uiStore.openModal('instanceSettings');
};
</script>