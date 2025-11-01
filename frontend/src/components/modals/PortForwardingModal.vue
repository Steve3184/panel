<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Port Forwarding Settings</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="d-flex justify-content-end mb-3">
            <button type="button" class="btn btn-sm btn-outline-primary" @click="addPort">
              <i class="bi bi-plus-lg me-2"></i> Add Port
            </button>
          </div>
          <div v-for="(port, index) in localPorts" :key="index" class="input-group mb-2">
            <input type="number" class="form-control" placeholder="Host Port" v-model.number="port.hostPort">
            <span class="input-group-text">:</span>
            <input type="number" class="form-control" placeholder="Container Port" v-model.number="port.containerPort">
            <select class="form-select" v-model="port.protocol">
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
            <button class="btn btn-outline-danger" type="button" @click="removePort(index)">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
          <button type="button" class="btn btn-primary" @click="save">Save Ports</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';

const props = defineProps({
  ports: { type: Array, default: () => [] }
});
const emit = defineEmits(['update:ports']);

const uiStore = useUiStore();
const modalEle = ref(null);
let modal = null;
const localPorts = ref([]);

// Helper functions for ports (copied from CreateInstanceModal.vue for now)
const parsePortString = (portString) => {
    if (typeof portString !== 'string') {
        return null;
    }
    const parts = portString.split(':');
    let hostPort = '';
    let containerPort = '';
    let protocol = 'tcp';

    if (parts.length === 2) {
        hostPort = parts[0];
        const containerParts = parts[1].split('/');
        containerPort = containerParts[0];
        if (containerParts.length === 2) {
            protocol = containerParts[1];
        }
    } else if (parts.length === 1) {
        hostPort = parts[0];
        containerPort = parts[0];
    } else {
        return null;
    }
    return { hostPort: hostPort ? parseInt(hostPort) : '', containerPort: containerPort ? parseInt(containerPort) : '', protocol };
};

const formatPortObject = (port) => {
    let formatted = `${port.hostPort}:${port.containerPort}`;
    if (port.protocol && port.protocol !== 'tcp') {
        formatted += `/${port.protocol}`;
    }
    return formatted;
};

watch(() => props.ports, (newPorts) => {
  localPorts.value = newPorts.map(parsePortString).filter(p => p !== null);
}, { immediate: true, deep: true });

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('portForwarding');
  });
  // Initial display based on uiStore.modals.portForwarding
  if (uiStore.modals.portForwarding) {
    modal.show();
  }
});

onBeforeUnmount(() => {
  modal?.dispose();
});

const close = () => {
  if (modal) {
    modal.hide();
  }
  uiStore.closeModal('portForwarding');
};

watch(() => uiStore.modals.portForwarding, (show) => {
  if (show) {
    localPorts.value = props.ports.map(parsePortString).filter(p => p !== null);
    modal.show();
  } else {
    modal.hide();
  }
});

const addPort = () => {
  localPorts.value.push({ hostPort: '', containerPort: '', protocol: 'tcp' });
};

const removePort = (index) => {
  localPorts.value.splice(index, 1);
};

const save = () => {
  const formattedPorts = localPorts.value
    .filter(p => p.hostPort && p.containerPort)
    .map(formatPortObject);
  emit('update:ports', formattedPorts);
  close();
};
</script>