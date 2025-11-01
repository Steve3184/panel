<template>
  <div class="modal fade" tabindex="-1" ref="modalEle">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">{{ $t('panel.change_language') }}</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="language-select" class="form-label">{{ $t('panel.select_language') }}</label>
            <select class="form-select" id="language-select" v-model="selectedLang">
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="zh_CN">简体中文</option>
              <option value="jp">日本語</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
          <button type="button" class="btn btn-primary" @click="saveLanguage">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import * as bootstrap from 'bootstrap';
import { useUiStore } from '../../stores/ui';
import { useI18n } from '../../composables/useI18n';

const uiStore = useUiStore();
const i18n = useI18n();
const modalEle = ref(null);
let modal = null;

const selectedLang = ref(i18n.currentLang.value);

onMounted(() => {
  modal = new bootstrap.Modal(modalEle.value);
  // Initial display based on uiStore.modals.changeLanguage
  if (uiStore.modals.changeLanguage) {
    modal.show();
  }

  modalEle.value.addEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('changeLanguage');
  });
});

onBeforeUnmount(() => {
  modalEle.value.removeEventListener('hidden.bs.modal', () => {
    uiStore.closeModal('changeLanguage');
  });
  modal?.dispose();
});

watch(() => uiStore.modals.changeLanguage, (isVisible) => {
  if (isVisible) modal.show();
  else modal.hide();
});

const close = () => uiStore.closeModal('changeLanguage');

const saveLanguage = () => {
  i18n.saveLanguagePreference(selectedLang.value);
  i18n.loadTranslations(selectedLang.value);
  close();
};
</script>