<template>
  <div class="modal fade" tabindex="-1" ref="panelSettingsModalRef">
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ $t('panelSettings.title') }}</h5>
          <button type="button" class="btn-close" @click="closeModal"></button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="saveSettings">
            <div class="mb-3">
              <label for="panelName" class="form-label">{{ $t('panelSettings.panelName') }}:</label>
              <input type="text" class="form-control" id="panelName" v-model="settings.panelName" />
            </div>

            <div class="mb-3">
              <div class="d-flex align-items-center">
                <div class="w-100">
                  <label for="panelLogo" class="form-label">{{ $t('panelSettings.panelLogo') }}:</label>

              <div class="d-flex align-items-center">
                  <input type="file" class="form-control" id="panelLogo" @change="handleLogoUpload" accept="image/*" />
                <button type="button" class="btn btn-sm btn-outline-danger ms-2" @click="deleteLogo"><i class="bi bi-trash"></i></button>
                </div></div>
                <div v-if="settings.panelLogo" class="ms-3 d-flex align-items-center">
                  <img :src="settings.panelLogo" alt="Panel Logo" class="img-thumbnail logo-preview" />
                </div>
              </div>
            </div>

            <div class="mb-3">
              <label for="backgroundImage" class="form-label">{{ $t('panelSettings.backgroundImage') }}:</label>
              <div class="d-flex align-items-center">
                <input type="file" class="form-control" id="backgroundImage" @change="handleBackgroundImageUpload"
                  accept="image/jpeg" />
                <button type="button" class="btn btn-sm btn-outline-danger ms-2" @click="clearBackgroundImage">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
              <div class="form-text">{{ $t('panelSettings.backgroundImageUploadHint') }}</div>
              <div v-if="uiStore.panelBackground" class="mt-2">
                <h6>{{ $t('panelSettings.preview') }}:</h6>
                <img :src="uiStore.panelBackground" alt="Background Preview" class="img-thumbnail" />
              </div>
            </div>
 
             <div class="mb-3 form-check form-switch">
               <input class="form-check-input" type="checkbox" id="gradioTunnelEnabled"
                 v-model="settings.gradioTunnel.enabled" />
               <label class="form-check-label" for="gradioTunnelEnabled">{{ $t('panelSettings.enableGradioTunnel') }}</label>
             </div>

            <div class="mb-3" v-if="settings.gradioTunnel?.enabled">
              <label for="gradioShareToken" class="form-label">{{ $t('panelSettings.tunnelToken') }}:</label>
              <input type="text" class="form-control" id="gradioShareToken"
                v-model="settings.gradioTunnel.shareToken" />
            </div>

            <div class="mb-3" v-if="settings.gradioTunnel?.enabled && settings.gradioTunnelUrl">
              <label for="gradioTunnelUrl" class="form-label">{{ $t('panelSettings.generatedGradioTunnelLink') }}:</label>
              <input type="text" class="form-control" id="gradioTunnelUrl" :value="settings.gradioTunnelUrl" readonly />
            </div>

            <div class="mb-3">
              <label for="panelPort" class="form-label">{{ $t('panelSettings.panelPort') }}:</label>
              <input type="number" class="form-control" id="panelPort" v-model="settings.panelPort" />
            </div>

            <div class="modal-footer">
              <button type="submit" class="btn btn-primary">{{ $t('save') }}</button>
              <button type="button" class="btn btn-secondary" @click="closeModal">{{ $t('close') }}</button>
              <button type="button" class="btn btn-danger" @click="restartPanel">{{ $t('panelSettings.restartPanel') }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import api from '../../services/api';
import { Modal } from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useI18n } from '../../composables/useI18n';

const uiStore = useUiStore();
const { t } = useI18n();

const props = defineProps({
  isVisible: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:isVisible']);

const settings = ref({
  panelName: '',
  panelLogo: '',
  panelBackgroundFile: null, // 用于存储待上传的图片文件
  panelBackgroundDeleted: false, // 新增的标志
  gradioTunnel: {
    enabled: false,
    shareToken: ''
  },
  panelPort: 3000,
  gradioTunnelUrl: null
});

watch(() => uiStore.panelSettings, (newSettings) => {
  if (newSettings) {
    settings.value = {
      ...newSettings,
    };
  } else {
    // Reset to default if panelSettings becomes null (e.g., on error)
    settings.value = {
      panelName: '',
      panelLogo: '',
      gradioTunnel: {
        enabled: false,
        shareToken: ''
      },
      panelPort: 8080,
      gradioTunnelUrl: null
    };
  }
}, { deep: true, immediate: true });

onMounted(async () => {
  modalInstance = new Modal(panelSettingsModalRef.value);
  panelSettingsModalRef.value.addEventListener('hidden.bs.modal', () => {
    emit('update:isVisible', false);
  });
  // 确保在显示 modal 之前获取最新的面板设置
  await uiStore.fetchPanelSettings();
  if (uiStore.panelSettings && uiStore.panelSettings.panelBackground) {
    uiStore.updatePanelBackground(uiStore.panelSettings.panelBackground);
  } else {
    uiStore.updatePanelBackground('');
  }
  try {
    const backgroundResponse = await api.getBackgroundImage();
    if (backgroundResponse.ok) {
      uiStore.updatePanelBackground('/api/panel-settings/background');
    }
  } catch (error) {
    // Handle error if necessary
  }
  modalInstance.show();
});

let modalInstance = null;
const panelSettingsModalRef = ref({});

onMounted(() => {
  modalInstance = new Modal(panelSettingsModalRef.value);
  panelSettingsModalRef.value.addEventListener('hidden.bs.modal', () => {
    emit('update:isVisible', false);
  });
});

onUnmounted(() => {
  if (modalInstance) {
    modalInstance.dispose();
  }
});

watch(() => props.isVisible, (newVal) => {
  if (newVal) {
    modalInstance.show();
  } else {
    modalInstance.hide();
  }
});

const closeModal = () => {
  modalInstance.hide();
};

const handleLogoUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > 768 || height > 768) {
          if (width > height) {
            height = Math.round(height * (768 / width));
            width = 768;
          } else {
            width = Math.round(width * (768 / height));
            height = 768;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        settings.value.panelLogo = canvas.toDataURL('image/png'); // Convert to PNG base64
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
};

const deleteLogo = () => {
  settings.value.panelLogo = '';
};

const handleBackgroundImageUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxWidth = 2560; // 2K
        const maxHeight = 1440; // 2K

        if (width > maxWidth || height > maxHeight) {
          const aspectRatio = width / height;
          if (width > height) {
            width = maxWidth;
            height = width / aspectRatio;
          } else {
            height = maxHeight;
            width = height * aspectRatio;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            settings.value.panelBackgroundFile = blob; // 存储文件，待保存时上传
            uiStore.updatePanelBackground(canvas.toDataURL('image/jpeg', 0.9)); // 用于预览
            settings.value.panelBackgroundDeleted = false; // 清除删除标记
          }
        }, 'image/jpeg', 0.9);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
};

const clearBackgroundImage = () => {
  settings.value.panelBackgroundDeleted = true;
  uiStore.updatePanelBackground('');
};

const saveSettings = async () => {
  try {
    // 处理背景图片删除
    if (settings.value.panelBackgroundDeleted) { // 只有当有背景图片且标记为删除时才执行删除
      await api.deleteBackgroundImage();
      uiStore.showToast(t('panelSettings.backgroundImageClearSuccess'), 'success');
      uiStore.updatePanelBackground(''); // Clear background in UI store
      settings.value.panelBackgroundDeleted = false; // 重置删除标记
    }

    // 处理背景图片上传
    if (settings.value.panelBackgroundFile) {
      const formData = new FormData();
      formData.append('backgroundImage', settings.value.panelBackgroundFile, 'custom_background.jpg');
      await api.uploadBackgroundImage(formData);
      uiStore.showToast(t('panelSettings.backgroundImageUploadSuccess'), 'success');
      settings.value.panelBackgroundFile = null; // 清除文件
    }

    // 保存其他面板设置
    await api.updatePanelSettings(settings.value);
    uiStore.showToast(t('panelSettings.savedSuccess'), 'success');
    
    // 刷新设置以获取最新的背景图片 URL
    await uiStore.fetchPanelSettings();
    if (uiStore.panelSettings && uiStore.panelSettings.panelBackground) {
      uiStore.updatePanelBackground(uiStore.panelSettings.panelBackground);
    } else {
      uiStore.updatePanelBackground('');
    }
    try {
      const backgroundResponse = await api.getBackgroundImage();
      if (backgroundResponse.ok) {
        uiStore.updatePanelBackground('/api/panel-settings/background');
      }
    } catch (error) {
      // Handle error if necessary
    }
    closeModal();
  } catch (error) {
    console.error(t('panelSettings.savedFailed'), error);
    uiStore.showToast(t('panelSettings.savedFailed') + ': ' + error.message, 'danger');
  }
};

const restartPanel = async () => {
  try {
    await api.restartPanel();
    // 提示用户服务器将重启
    uiStore.showToast(t('panelSettings.restartingPanel'), 'success');
    closeModal();
  } catch (error) {}
};
</script>

<style scoped>
.modal.show {
  background: rgba(0, 0, 0, 0.5);
}

.logo-preview {
  max-width: 100px;
  max-height: 100px;
}
</style>