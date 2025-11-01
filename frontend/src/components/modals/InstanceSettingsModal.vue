<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog modal-lg">
      <div class="modal-content" v-if="form">
          <form @submit.prevent="handleSubmit">
            <div class="modal-header">
              <h5 class="modal-title">{{ $t('instances.settings') }}</h5>
              <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label for="settings-instance-name" class="form-label">{{ $t('instances.name') }}</label>
                <input type="text" class="form-control" id="settings-instance-name" v-model="form.name" required>
              </div>
              <div class="mb-3">
                <label for="settings-instance-type" class="form-label">{{ $t('instances.type') }}</label>
                <select class="form-select" id="settings-instance-type" v-model="form.type">
                  <option value="shell">{{ $t('instances.type.shell') }}</option>
                  <option value="docker">{{ $t('instances.type.container') }}</option>
                </select>
              </div>
              <div class="mb-3" :class="{ 'd-none': form.type === 'docker' }">
                <label for="settings-instance-command" class="form-label">{{ $t('instances.command') }}</label>
                <input type="text" class="form-control" id="settings-instance-command" v-model="form.command"
                  :placeholder="$t('instances.command.placeholder')" :required="form.type === 'shell'">
              </div>

              <!-- Docker 容器设置 -->
              <div id="docker-settings-settings" :class="{ 'd-none': form.type === 'shell' }">
                <hr>
                <h5 class="mb-3">{{ $t('instances.docker.settings') }}</h5>
                <div class="modal-grid-row">
                  <div class="modal-grid-col">
                    <div class="mb-3">
                      <label for="settings-docker-image" class="form-label">{{ $t('instances.docker.image') }}</label>
                      <input type="text" class="form-control" id="settings-docker-image" v-model="form.dockerConfig.image"
                        :placeholder="$t('instances.docker.image.placeholder')">
                    </div>
                  </div>
                  <div class="modal-grid-col">
                    <div class="mb-3">
                      <label for="settings-docker-container-name" class="form-label">{{ $t('instances.docker.container')
                      }}</label>
                      <input type="text" class="form-control" id="settings-docker-container-name"
                        v-model="form.dockerConfig.containerName"
                        :placeholder="$t('instances.docker.container.placeholder')">
                    </div>
                  </div>
                </div>
                <div class="mb-3">
                  <label for="settings-docker-ports" class="form-label">{{ $t('instances.docker.ports') }}</label>
                  <button type="button" class="btn btn-sm btn-outline-secondary ms-2"
                    @click="openPortForwardingModal(form.dockerConfig.ports)">{{ $t('instances.docker.ports.edit')
                    }}</button>
                  <div class="form-control mt-2" style="min-height: 38px;">{{
                    formatPortsDisplay(form.dockerConfig.ports) }}</div>
                  <div class="form-text">{{ $t('instances.docker.ports.hint') }}</div>
                </div>
                <div class="mb-3">
                  <label for="settings-docker-volumes" class="form-label">{{ $t('instances.docker.volumes') }}</label>
                  <button type="button" class="btn btn-sm btn-outline-secondary ms-2"
                    @click="openVolumeMountingModal(form.dockerConfig.volumes)">{{ $t('instances.docker.volumes.edit')
                    }}</button>
                  <div class="form-control mt-2" style="min-height: 38px;">{{
                    formatVolumesDisplay(form.dockerConfig.volumes) }}</div>
                  <div class="form-text">{{ $t('instances.docker.volumes.hint') }}</div>
                </div>
                <div class="mb-3">
                  <label for="settings-docker-working-dir" class="form-label">{{ $t('instances.docker.workdir') }}</label>
                  <input type="text" class="form-control" id="settings-docker-working-dir"
                    v-model="form.dockerConfig.workingDir" :placeholder="$t('instances.docker.workdir.placeholder')">
                  <div class="form-text">{{ $t('instances.docker.workdir.hint') }}</div>
                </div>
                <div class="mb-3">
                  <label for="settings-docker-command" class="form-label">{{ $t('instances.docker.command') }}</label>
                  <input type="text" class="form-control" id="settings-docker-command" v-model="form.dockerConfig.command"
                    :placeholder="$t('instances.docker.command.placeholder')">
                  <div class="form-text">{{ $t('instances.docker.command.hint') }}</div>
                </div>
                <hr>
              </div>

              <div class="mb-3">
                <label for="settings-instance-cwd" class="form-label">{{ $t('instances.workdir') }}</label>
                <input type="text" class="form-control" id="settings-instance-cwd" v-model="form.cwd"
                  :placeholder="$t('instances.workdir.placeholder')">
                <div class="form-text">{{ $t('instances.workdir.hint') }}</div>
              </div>
              <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" role="switch" id="settings-autostart"
                  v-model="form.autoStartOnBoot">
                <label class="form-check-label" for="settings-autostart">{{ $t('instances.options.autostart') }}</label>
              </div>
              <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" role="switch" id="settings-autorestart"
                  v-model="form.autoRestart">
                <label class="form-check-label" for="settings-autorestart">{{ $t('instances.options.autorestart')
                }}</label>
              </div>
              <div class="form-check form-switch mb-3">
                <input class="form-check-input" type="checkbox" role="switch" id="settings-autodelete"
                  v-model="form.autoDeleteOnExit">
                <label class="form-check-label" for="settings-autodelete">{{ $t('instances.options.autodelete')
                }}</label>
              </div>
              <div class="mb-3">
                <label for="settings-instance-env" class="form-label">{{ $t('instances.envvar') }}</label>
                <textarea class="form-control" id="settings-instance-env" rows="3" v-model="envString"
                  :placeholder="$t('instances.envvar.placeholder')"></textarea>
                <div class="form-text">{{ $t('instances.envvar.hint') }}</div>
              </div>

              <!-- Danger Zone -->
              <hr>
              <div class="mt-3" v-if="sessionStore.currentUser && sessionStore.currentUser.role === 'admin'">
                <h5 class="text-danger">{{ $t('instances.danger') }}</h5>
                <p>{{ $t('instances.danger.delete.warning') }}</p>
                <div class="btn-group">
                  <button type="button" class="btn btn-danger dropdown-toggle" data-bs-toggle="dropdown"
                    aria-expanded="false">
                    <i class="bi bi-trash me-1"></i> {{ $t('instances.danger.delete') }}
                  </button>
                  <ul class="dropdown-menu">
                    <li><a class="dropdown-item text-danger" href="#" @click="openDeleteConfirm(false)">{{
                      $t('instances.danger.remove_only') }}</a>
                    </li>
                    <li><a class="dropdown-item text-danger" href="#" @click="openDeleteConfirm(true)">{{
                      $t('instances.danger.delete_all') }}</a>
                    </li>
                  </ul>
                </div>
              </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="close">{{ $t('cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ $t('instances.save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
   <ConfirmDeleteModal
        v-if="uiStore.modals.confirmDelete"
        :title="deleteTarget.title"
        :message="deleteTarget.message"
        :item-name="instance.name"
        @confirm="confirmDelete"
    />
    <PortForwardingModal v-show="uiStore.modals.portForwarding" :ports="form.dockerConfig.ports" @update:ports="form.dockerConfig.ports = $event" />
    <VolumeMountingModal v-show="uiStore.modals.volumeMounting" :volumes="form.dockerConfig.volumes" @update:volumes="form.dockerConfig.volumes = $event" />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useInstancesStore } from '../../stores/instances';
import { useFileManagerStore } from '../../stores/fileManager';
import { useSessionStore } from '../../stores/session';
import { useI18n } from '../../composables/useI18n';
import ConfirmDeleteModal from './ConfirmDeleteModal.vue';
import PortForwardingModal from './PortForwardingModal.vue';
import VolumeMountingModal from './VolumeMountingModal.vue';

const props = defineProps({
  instance: { type: Object, required: true }
});

const uiStore = useUiStore();
const instancesStore = useInstancesStore();
const fileManagerStore = useFileManagerStore();
const sessionStore = useSessionStore();
const { t } = useI18n();
const modalEle = ref(null);
let modal = null;

const form = ref(null);
const deleteTarget = ref({});

const envString = computed({
    get: () => form.value?.env ? Object.entries(form.value.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    set: (value) => {
        if (form.value) {
            form.value.env = value.split('\n').reduce((acc, line) => {
                const [key, ...val] = line.split('=');
                if (key) acc[key] = val.join('=');
                return acc;
            }, {});
        }
    }
});

// Helper functions for ports
const parsePortString = (portString) => {
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

// Helper functions for volumes
const parseVolumeString = (volumeString) => {
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

const formatPortsDisplay = computed(() => (ports) => {
    if (!ports || ports.length === 0) {
        return t('instances.docker.ports.not_configured');
    }
    return ports.join(', ');
});

const formatVolumesDisplay = computed(() => (volumes) => {
    if (!volumes || volumes.length === 0) {
        return t('instances.docker.volumes.not_configured');
    }
    return volumes.join(', ');
});

onMounted(() => {
    modal = new bootstrap.Modal(modalEle.value);
    modalEle.value.addEventListener('hidden.bs.modal', () => {
        uiStore.closeModal('instanceSettings');
    });
    // Initial display based on uiStore.modals.instanceSettings
    if (uiStore.modals.instanceSettings) {
        modal.show();
    }
});

onBeforeUnmount(() => {
    if (modal) {
        modal.dispose();
    }
});

watch(() => props.instance, (newInstance) => {
    if (newInstance) {
        form.value = JSON.parse(JSON.stringify(newInstance));
    }
}, { immediate: true });

watch(() => uiStore.modals.instanceSettings, (isVisible) => {
    if (isVisible) {
        form.value = JSON.parse(JSON.stringify(props.instance));
        modal.show();
    } else {
        modal.hide();
    }
});

const close = () => uiStore.closeModal('instanceSettings');

const openPortForwardingModal = (currentPorts) => {
    fileManagerStore.portEditorPorts = currentPorts.map(parsePortString).filter(p => p !== null);
    uiStore.openModal('portForwarding');
};

const openVolumeMountingModal = (currentVolumes) => {
    fileManagerStore.volumeEditorVolumes = currentVolumes.map(parseVolumeString).filter(v => v !== null);
    uiStore.openModal('volumeMounting');
};

watch(() => fileManagerStore.portEditorPorts, (newPorts) => {
    form.value.dockerConfig.ports = newPorts.map(formatPortObject);
}, { deep: true });

watch(() => fileManagerStore.volumeEditorVolumes, (newVolumes) => {
    form.value.dockerConfig.volumes = newVolumes.map(formatVolumeObject);
}, { deep: true });

const handleSubmit = async () => {
    if (form.value.type === 'shell' && !form.value.command) {
        uiStore.showToast(t('error.command_required'), 'danger');
        return;
    }
    if (form.value.type === 'docker' && !form.value.dockerConfig.image) {
        uiStore.showToast(t('error.image_required'), 'danger');
        return;
    }

    const payload = { ...form.value };
    payload.env = envString.value.split('\n').reduce((acc, line) => {
        const [key, ...val] = line.split('=');
        if (key) acc[key] = val.join('=');
        return acc;
    }, {});

    if (payload.type === 'docker') {
        // Ports and volumes are already in string array format from the modals
        // No need to re-parse them here.
    } else {
        delete payload.dockerConfig;
    }

    await instancesStore.updateInstance(props.instance.id, payload);
    uiStore.closeModal('instanceSettings');
};

const openDeleteConfirm = (deleteData) => {
    deleteTarget.value = {
        deleteData,
        title: t('confirm.delete.title'),
        message: deleteData ? t('instances.danger.delete.confirm', { type: form.value.type == 'docker' ? 'Docker' : '' }) : t('instances.danger.delete.remove_only.confirm', { type: form.value.type == 'docker' ? 'Docker' : '' })
    };
    uiStore.openModal('confirmDelete');
};

const confirmDelete = async () => {
    await instancesStore.deleteInstance(props.instance.id, deleteTarget.value.deleteData);
    uiStore.closeModal('confirmDelete');
    uiStore.closeModal('instanceSettings');
};
</script>