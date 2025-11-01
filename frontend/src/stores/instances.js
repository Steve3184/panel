import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../services/api';
import { useUiStore } from './ui';

export const useInstancesStore = defineStore('instances', () => {
    const uiStore = useUiStore();
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
            uiStore.showToast(`Failed to fetch instances: ${error.message}`, 'danger');
        }
    }

    async function performAction(id, action) {
        try {
            await api.instanceAction(id, action);
            uiStore.showToast(`Action '${action}' initiated.`, 'success');
        } catch (error) {
            uiStore.showToast(`Action '${action}' failed: ${error.message}`, 'danger');
        }
    }
    
    async function createInstance(data) {
        try {
            await api.createInstance(data);
            uiStore.showToast('Instance created successfully.', 'success');
            uiStore.closeModal('createInstance');
        } catch (error) {
            uiStore.showToast(`Failed to create instance: ${error.message}`, 'danger');
        }
    }

    async function updateInstance(id, data) {
         try {
            await api.updateInstance(id, data);
            uiStore.showToast('Instance updated successfully.', 'success');
            uiStore.closeModal('instanceSettings');
        } catch (error) {
            uiStore.showToast(`Failed to update instance: ${error.message}`, 'danger');
        }
    }
    
    async function deleteInstance(id, deleteData) {
        try {
            await api.deleteInstance(id, deleteData);
            const message = deleteData ? 'Instance and data deleted.' : 'Instance removed.';
            uiStore.showToast(message, 'success');
            uiStore.closeModal('instanceSettings');
            uiStore.closeModal('confirmDelete');
        } catch (error) {
            uiStore.showToast(`Failed to delete instance: ${error.message}`, 'danger');
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