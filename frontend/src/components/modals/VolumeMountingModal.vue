<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Volume Mounting Settings</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="d-flex justify-content-end mb-3">
            <button type="button" class="btn btn-sm btn-outline-primary" @click="addVolume">
              <i class="bi bi-plus-lg me-2"></i> Add Volume
            </button>
          </div>
          <div v-for="(volume, index) in localVolumes" :key="index" class="input-group mb-2">
            <input type="text" class="form-control" placeholder="Host Path" v-model="volume.source">
            <span class="input-group-text">:</span>
            <input type="text" class="form-control" placeholder="Container Path" v-model="volume.destination">
            <div class="input-group-text">
              <div class="form-check form-switch m-0">
                <input class="form-check-input" type="checkbox" v-model="volume.readOnly">
                <label class="form-check-label small">RO</label>
              </div>
            </div>
            <button class="btn btn-outline-danger" type="button" @click="removeVolume(index)">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
          <button type="button" class="btn btn-primary" @click="save">Save Volumes</button>
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
  volumes: { type: Array, default: () => [] }
});
const emit = defineEmits(['update:volumes']);

const uiStore = useUiStore();
const modalEle = ref(null);
let modal = null;
const localVolumes = ref([]);

// Helper functions for volumes (copied from CreateInstanceModal.vue for now)
const parseVolumeString = (volumeString) => {
    if (typeof volumeString !== 'string') {
        return null;
    }
    const parts = volumeString.split(':');
    const source = parts[0];
    const destination = parts[1];
    const readOnly = parts.length === 3 && parts[2] === 'ro';
    return { source, destination, readOnly };
};

const formatVolumeObject = (volume) => {
    let formatted = `${volume.source}:${volume.destination}`;
    if (volume.readOnly) {
        formatted += ':ro';
    }
    return formatted;
};

watch(() => props.volumes, (newVolumes) => {
  localVolumes.value = newVolumes.map(parseVolumeString).filter(v => v !== null);
}, { immediate: true, deep: true });

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('volumeMounting');
  });
  // Initial display based on uiStore.modals.volumeMounting
  if (uiStore.modals.volumeMounting) {
    modal.show();
  }
});

watch(() => uiStore.modals.volumeMounting, (show) => {
  if (show) {
    localVolumes.value = props.volumes.map(parseVolumeString).filter(v => v !== null);
    modal.show();
  } else {
    modal.hide();
  }
});

onBeforeUnmount(() => modal?.dispose());

const close = () => {
  if (modal) {
    modal.hide();
  }
  uiStore.closeModal('volumeMounting');
};

const addVolume = () => {
  localVolumes.value.push({ source: '', destination: '', readOnly: false });
};

const removeVolume = (index) => {
  localVolumes.value.splice(index, 1);
};

const save = () => {
  const formattedVolumes = localVolumes.value
    .filter(v => v.source && v.destination)
    .map(formatVolumeObject);
  emit('update:volumes', formattedVolumes);
  close();
};
</script>