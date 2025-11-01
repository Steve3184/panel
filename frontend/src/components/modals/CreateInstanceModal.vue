<template>
    <div class="modal fade" id="createInstanceModal" tabindex="-1" ref="modalEle">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">{{ $t('instances.create.title') }}</h5>
                    <button type="button" class="btn-close" @click="uiStore.closeModal('createInstance')"
                        aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form id="create-instance-form" @submit.prevent="submitForm">
                        <div class="mb-3">
                            <label for="create-instance-name" class="form-label">{{ $t('instances.name') }}</label>
                            <input type="text" class="form-control" id="create-instance-name" v-model="form.name"
                                :placeholder="$t('instances.name.hint')">
                            <div class="form-text">{{ $t('instances.name.hint') }}</div>
                        </div>
                        <div class="mb-3">
                            <label for="create-instance-type" class="form-label">{{ $t('instances.type') }}</label>
                            <select class="form-select" id="create-instance-type" v-model="form.type">
                                <option value="shell">{{ $t('instances.type.shell') }}</option>
                                <option value="docker">{{ $t('instances.type.container') }}</option>
                            </select>
                        </div>
                        <div class="mb-3" :class="{ 'd-none': form.type === 'docker' }">
                            <label for="create-instance-command" class="form-label">{{ $t('instances.command')
                            }}</label>
                            <input type="text" class="form-control" id="create-instance-command" v-model="form.command"
                                :placeholder="t('instances.command.placeholder')" :required="form.type === 'shell'">
                        </div>

                        <!-- Docker 容器设置 -->
                        <div id="docker-settings-create" :class="{ 'd-none': form.type === 'shell' }">
                            <hr>
                            <h5 class="mb-3">{{ $t('instances.docker.settings') }}</h5>
                            <div class="modal-grid-row">
                                <div class="modal-grid-col">
                                    <div class="mb-3">
                                        <label for="create-docker-image" class="form-label">{{
                                            $t('instances.docker.image') }}</label>
                                        <input type="text" class="form-control" id="create-docker-image"
                                            v-model="form.dockerConfig.image"
                                            :placeholder="t('instances.docker.image.placeholder')">
                                    </div>
                                </div>
                                <div class="modal-grid-col">
                                    <div class="mb-3">
                                        <label for="create-docker-container-name" class="form-label">{{
                                            $t('instances.docker.container') }}</label>
                                        <input type="text" class="form-control" id="create-docker-container-name"
                                            v-model="form.dockerConfig.containerName"
                                            :placeholder="t('instances.docker.container.placeholder')">
                                    </div>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label for="create-docker-ports" class="form-label">{{ $t('instances.docker.ports')
                                }}</label>
                                <button type="button" class="btn btn-sm btn-outline-secondary ms-2"
                                    @click="openPortForwardingModal(form.dockerConfig.ports)">{{
                                        $t('instances.docker.ports.edit') }}</button>
                                <div class="form-control mt-2" style="min-height: 38px;">{{
                                    formatPortsDisplay(form.dockerConfig.ports) }}</div>
                                <div class="form-text">{{ $t('instances.docker.ports.hint') }}</div>
                            </div>
                            <div class="mb-3">
                                <label for="create-docker-volumes" class="form-label">{{ $t('instances.docker.volumes')
                                }}</label>
                                <button type="button" class="btn btn-sm btn-outline-secondary ms-2"
                                    @click="openVolumeMountingModal(form.dockerConfig.volumes)">{{
                                        $t('instances.docker.volumes.edit') }}</button>
                                <div class="form-control mt-2" style="min-height: 38px;">{{
                                    formatVolumesDisplay(form.dockerConfig.volumes) }}</div>
                                <div class="form-text">{{ $t('instances.docker.volumes.hint') }}</div>
                            </div>
                            <div class="mb-3">
                                <label for="create-docker-working-dir" class="form-label">{{
                                    $t('instances.docker.workdir') }}</label>
                                <input type="text" class="form-control" id="create-docker-working-dir"
                                    v-model="form.dockerConfig.workingDir"
                                    :placeholder="t('instances.docker.workdir.placeholder')">
                                <div class="form-text">{{ t('instances.docker.workdir.hint') }}</div>
                            </div>
                            <div class="mb-3">
                                <label for="create-docker-command" class="form-label">{{ $t('instances.docker.command')
                                }}</label>
                                <input type="text" class="form-control" id="create-docker-command"
                                    v-model="form.dockerConfig.command"
                                    :placeholder="t('instances.docker.command.placeholder')">
                                <div class="form-text">{{ t('instances.docker.command.hint') }}</div>
                            </div>
                            <hr>
                        </div>

                        <div class="mb-3">
                            <label for="create-instance-cwd" class="form-label">{{ $t('instances.workdir') }}</label>
                            <input type="text" class="form-control" id="create-instance-cwd" v-model="form.cwd"
                                :placeholder="t('instances.workdir.placeholder')">
                            <div class="form-text">{{ t('instances.workdir.hint') }}</div>
                        </div>
                        <div class="form-check form-switch mb-2">
                            <input class="form-check-input" type="checkbox" role="switch" id="create-autostart"
                                v-model="form.autoStartOnBoot">
                            <label class="form-check-label" for="create-autostart">{{ $t('instances.options.autostart')
                            }}</label>
                        </div>
                        <div class="form-check form-switch mb-3">
                            <input class="form-check-input" type="checkbox" role="switch" id="create-autodelete"
                                v-model="form.autoDeleteOnExit">
                            <label class="form-check-label" for="create-autodelete">{{
                                $t('instances.options.autodelete') }}</label>
                        </div>
                        <div class="mb-3">
                            <label for="create-instance-env" class="form-label">{{ $t('instances.envvar') }}</label>
                            <textarea class="form-control" id="create-instance-env" rows="3" v-model="form.env"
                                :placeholder="t('instances.envvar.placeholder')"></textarea>
                            <div class="form-text">{{ t('instances.envvar.hint') }}</div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" @click="uiStore.closeModal('createInstance')">{{
                        $t('cancel') }}</button>
                    <button type="submit" class="btn btn-primary" form="create-instance-form">{{ $t('instances.create')
                    }}</button>
                </div>
            </div>
        </div>
    </div>
    <PortForwardingModal v-show="uiStore.modals.portForwarding" :ports="form.dockerConfig.ports" @update:ports="form.dockerConfig.ports = $event" />
    <VolumeMountingModal v-show="uiStore.modals.volumeMounting" :volumes="form.dockerConfig.volumes" @update:volumes="form.dockerConfig.volumes = $event" />
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import * as bootstrap from 'bootstrap'; // Import all of Bootstrap's JS
import { useUiStore } from '../../stores/ui';
import { useInstancesStore } from '../../stores/instances';
import { useFileManagerStore } from '../../stores/fileManager'; // For volume mounting
import { useI18n } from '../../composables/useI18n';
import PortForwardingModal from './PortForwardingModal.vue'; // Import PortForwardingModal
import VolumeMountingModal from './VolumeMountingModal.vue';
const uiStore = useUiStore();
const instancesStore = useInstancesStore();
const fileManagerStore = useFileManagerStore(); // For volume mounting
const modalEle = ref(null);
const { t } = useI18n();
let modal = null;

const form = ref({
    name: '',
    command: 'bash',
    cwd: '',
    type: 'shell',
    autoStartOnBoot: false,
    autoDeleteOnExit: false,
    env: '', // Changed to string for textarea
    dockerConfig: {
        image: 'ubuntu:latest',
        containerName: '',
        ports: [], // Array of strings like "80:80/tcp"
        volumes: [], // Array of strings like "/host:/container"
        workingDir: '/workspace',
        command: '',
    }
});

// Helper functions for environment variables
const parseEnvString = (envString) => {
    const env = {};
    envString.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            const parts = trimmedLine.split('=');
            if (parts.length >= 2) {
                const key = parts[0];
                const value = parts.slice(1).join('=');
                env[key] = value;
            }
        }
    });
    return env;
};

const formatEnvObject = (envObject) => {
    return Object.entries(envObject).map(([key, value]) => `${key}=${value}`).join('\n');
};

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
        uiStore.closeModal('createInstance');
    });
    // Initial display based on uiStore.modals.createInstance
    if (uiStore.modals.createInstance) {
        modal.show();
    }
});

onBeforeUnmount(() => {
    if (modal) {
        modal.dispose();
    }
});

const openPortForwardingModal = (currentPorts) => {
    fileManagerStore.portEditorPorts = currentPorts;
    uiStore.openModal('portForwarding');
};

const openVolumeMountingModal = (currentVolumes) => {
    fileManagerStore.volumeEditorVolumes = currentVolumes;
    uiStore.openModal('volumeMounting');
};

watch(() => fileManagerStore.portEditorPorts, (newPorts) => {
    form.value.dockerConfig.ports = newPorts.map(formatPortObject);
}, { deep: true });

watch(() => fileManagerStore.volumeEditorVolumes, (newVolumes) => {
    form.value.dockerConfig.volumes = newVolumes.map(formatVolumeObject);
}, { deep: true });

watch(() => uiStore.modals.createInstance, (show) => {
    if (show) {
        modal.show();
    } else {
        modal.hide();
    }
});

const submitForm = async () => {
    // Basic validation
    if (form.value.type === 'shell' && !form.value.command) {
        uiStore.showToast(t('error.command_required'), 'danger');
        return;
    }
    if (form.value.type === 'docker' && !form.value.dockerConfig.image) {
        uiStore.showToast(t('error.image_required'), 'danger');
        return;
    }

    const payload = { ...form.value };
    payload.env = parseEnvString(form.value.env);

    if (payload.type === 'docker') {
        // Ports and volumes are already in string array format from the modals
        // No need to re-parse them here.
        // payload.dockerConfig.ports = payload.dockerConfig.ports.map(parsePortString).filter(p => p !== null);
        // payload.dockerConfig.volumes = payload.dockerConfig.volumes.map(parseVolumeString).filter(v => v !== null);
    } else {
        delete payload.dockerConfig;
    }

    await instancesStore.createInstance(payload);
    uiStore.closeModal('createInstance');
};
</script>