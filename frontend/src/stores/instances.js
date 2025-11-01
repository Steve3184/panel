import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../services/api';
import { useUiStore } from './ui';
import { useI18n } from '../composables/useI18n';

export const useInstancesStore = defineStore('instances', () => {
    const uiStore = useUiStore();
    const { t } = useI18n();
    const instances = ref([]);
    const systemStats = ref({ cpu: 0, mem: 0, totalMem: 0 });
    const instanceStats = ref({}); // { [id]: { cpu, mem } }

    const getInstanceById = computed(() => {
        return (id) => instances.value.find(i => i.id === id);
    });

    async function fetchInstances() {
        try {
            instances.value = await api.getInstances();
        } catch (error) {
            uiStore.showToast(t('instances.fetch.failed', { message: t(error.message) }), 'danger');
        }
    }

    async function performAction(id, action) {
        try {
            await api.instanceAction(id, action);
            uiStore.showToast(t('instances.action.initiated', { action: action }), 'success');
        } catch (error) {
            uiStore.showToast(t('instances.action.failed', { action: action, message: t(error.message) }), 'danger');
        }
    }
    
    async function createInstance(data) {
        try {
            await api.createInstance(data);
            uiStore.showToast(t('instances.create.success'), 'success');
            uiStore.closeModal('createInstance');
        } catch (error) {
            uiStore.showToast(t('instances.create.failed', { message: t(error.message) }), 'danger');
        }
    }

    async function updateInstance(id, data) {
         try {
            await api.updateInstance(id, data);
            uiStore.showToast(t('instances.update.success'), 'success');
            uiStore.closeModal('instanceSettings');
        } catch (error) {
            uiStore.showToast(t('instances.update.failed', { message: t(error.message) }), 'danger');
        }
    }
    
    async function deleteInstance(id, deleteData) {
        try {
            await api.deleteInstance(id, deleteData);
            const message = deleteData ? t('instances.delete.success.data') : t('instances.delete.success.no_data');
            uiStore.showToast(message, 'success');
            uiStore.closeModal('instanceSettings');
            uiStore.closeModal('confirmDelete');
        } catch (error) {
            uiStore.showToast(t('instances.delete.failed', { message: t(error.message) }), 'danger');
        }
    }

    // --- WebSocket Event Handlers ---
    function handleInstanceCreated(data) {
        instances.value.push(data.instance);
    }
    
    function handleInstanceDeleted(data) {
        instances.value = instances.value.filter(i => i.id !== data.id);
    }

    function handleInstanceUpdated(data) {
        const index = instances.value.findIndex(i => i.id === data.instance.id);
        if (index !== -1) {
            instances.value[index] = { ...instances.value[index], ...data.instance };
        }
    }

    function handleInstanceStatusChange(id, status) {
        const instance = instances.value.find(i => i.id === id);
        if (instance) {
            instance.status = status;
        }
    }
    
    function handleSystemStats(data) {
        systemStats.value = { cpu: data.cpu, mem: data.mem, totalMem: data.totalMem };
    }
    
    function handleInstanceStats(data) {
        instanceStats.value[data.id] = { cpu: data.cpu, memory: data.memory };
    }


    return {
        instances,
        systemStats,
        instanceStats,
        fetchInstances,
        getInstanceById,
        performAction,
        createInstance,
        updateInstance,
        deleteInstance,
        // WS handlers
        handleInstanceCreated,
        handleInstanceDeleted,
        handleInstanceUpdated,
        handleInstanceStatusChange,
        handleSystemStats,
        handleInstanceStats,
    };
});