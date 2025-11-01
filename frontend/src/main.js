import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as bootstrap from 'bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import { i18nPlugin } from './composables/useI18n'
import router from './router'
import './style.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18nPlugin)

app.mount('#app')