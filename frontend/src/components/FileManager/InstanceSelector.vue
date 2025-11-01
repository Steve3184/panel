<template>
  <div class="mb-3">
    <h5>Select an Instance to Manage Files</h5>
    <div v-if="instancesStore.instances.length === 0" class="text-muted text-center p-4">
      No instances available.
    </div>
    <div v-else class="list-group">
      <a v-for="instance in instancesStore.instances" :key="instance.id" href="#" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" @click.prevent="selectInstance(instance.id)">
        <div>
          <i class="bi bi-server me-2"></i> {{ instance.name }}
        </div>
         <span :class="['badge', instance.status === 'running' ? 'bg-success' : 'bg-secondary']">
            {{ instance.status }}
        </span>
      </a>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { useInstancesStore } from '../../stores/instances';
import { useFileManagerStore } from '../../stores/fileManager';

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
</script>