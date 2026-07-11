import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import { i18nPlugin, useI18n } from './composables/useI18n'
import router from './router'
import './style.css'
import App from './App.vue'
import api from './services/api'
import { useUiStore } from './stores/ui'

async function initializeApp() {
    const app = createApp(App)
    const pinia = createPinia()
    app.use(pinia)
    // 在 i18n 加载前获取面板设置
    let panelSettings = {};
    let capabilities = { platform: null, shellSandbox: { supported: false, reason: 'not-checked' } };
    const [panelSettingsResult, capabilitiesResult] = await Promise.allSettled([
        api.getPublicPanelSettings(),
        api.getCapabilities()
    ]);
    if (panelSettingsResult.status === 'fulfilled') panelSettings = panelSettingsResult.value;
    else console.error(panelSettingsResult.reason);
    if (capabilitiesResult.status === 'fulfilled') capabilities = capabilitiesResult.value;
    else console.error(capabilitiesResult.reason);

    app.use(i18nPlugin, { panelSettings });
    app.use(router)
    const uiStore = useUiStore(pinia);
    uiStore.panelSettings = panelSettings;
    uiStore.capabilities = capabilities;
    uiStore.updatePanelLogo(panelSettings.panelLogo);
    app.mount('#app')
}

initializeApp();
