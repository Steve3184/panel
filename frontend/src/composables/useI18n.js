import { ref, computed, inject, watch } from 'vue';

const i18nSymbol = Symbol('i18n');

const translations = ref({});
const currentLang = ref('auto');

async function loadTranslations(langCode) {
    let effectiveLangCode = langCode;
    if (langCode === 'auto') {
        const userLang = navigator.language || navigator.userLanguage;
        if (userLang.startsWith('zh')) effectiveLangCode = 'zh_CN';
        else if (userLang.startsWith('ja')) effectiveLangCode = 'jp';
        else effectiveLangCode = 'en';
    }

    try {
        const response = await fetch(`/lang/${effectiveLangCode}.json`);
        if (!response.ok) throw new Error('Failed to load translations');
        const loadedTranslations = await response.json();
        translations.value = { ...loadedTranslations }; // 确保是响应式对象
        currentLang.value = effectiveLangCode;
        document.documentElement.lang = effectiveLangCode.split('_')[0];
    } catch (error) {
        console.error('Error loading translations:', error);
        if (effectiveLangCode !== 'en') {
            await loadTranslations('en'); // Fallback to English
        }
    }
}

function getLanguagePreference() {
    const match = document.cookie.match(new RegExp('(^| )user_language=([^;]+)'));
    return match ? match[2] : null;
}

function saveLanguagePreference(langCode) {
    document.cookie = `user_language=${langCode}; path=/; max-age=31536000`;
}

function t(key, params = {}) {
    let message = translations.value[key] || key;
    for (const param in params) {
        message = message.replace(`{${param}}`, params[param]);
    }
    return message;
}

export function useI18n() {
    return inject(i18nSymbol);
}

export const i18nPlugin = {
    install(app, options) {
        const i18n = {
            t,
            loadTranslations,
            saveLanguagePreference,
            currentLang: computed(() => currentLang.value),
            async waitTranslationLoad() {
                if (Object.keys(translations.value).length > 1) {
                    return;
                }
                return new Promise(resolve => {
                    const stopWatch = watch(translations, (newVal) => {
                        if (Object.keys(newVal).length > 1) {
                            stopWatch();
                            resolve();
                        }
                    }, { deep: true });
                });
            }
        };

        app.provide(i18nSymbol, i18n);
        app.config.globalProperties.$t = t;

        const preferredLang = getLanguagePreference() || 'auto';
        if (options && options.panelSettings && options.panelSettings.panelName) {
            translations.value['panel.name'] = options.panelSettings.panelName;
        }
        loadTranslations(preferredLang).then(() => {
            // 在加载完语言包后，如果panelSettings中存在panelName，则覆盖panel.name
            if (options && options.panelSettings && options.panelSettings.panelName) {
                translations.value['panel.name'] = options.panelSettings.panelName;
            }
        });
    }
};