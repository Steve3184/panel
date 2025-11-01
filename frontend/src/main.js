import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import { i18nPlugin, useI18n } from './composables/useI18n'
import router from './router'
import './style.css'
import App from './App.vue'
import api from './services/api' // 导入 api 服务
import { useUiStore } from './stores/ui'

async function initializeApp() {
    const app = createApp(App)
    app.use(createPinia())
    // 在 i18n 加载前获取面板设置
    let panelSettings = {};
    try {
        panelSettings = await api.getPanelSettings();
    } catch (error) {
        console.error('获取面板设置失败:', error);
    }

    app.use(i18nPlugin, { panelSettings });
    app.use(router)
    app.mount('#app')
    const uiStore = useUiStore();
    uiStore.updatePanelLogo(panelSettings.panelLogo);
}

initializeApp();