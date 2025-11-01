import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { panelSettings } from '../api/controllers/panelSettingsController.js'; // 导入 panelSettings

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(path.dirname(__filename)));

const translations = {};
let currentLang = 'en';

function loadTranslations(lang) {
    const langFilePath = path.join(__dirname, 'frontend', 'public', 'lang', `${lang}.json`);
    try {
        const data = fs.readFileSync(langFilePath, 'utf8');
        translations[lang] = JSON.parse(data);
        console.log(`Loaded translations for ${lang}`);
    } catch (error) {
        console.error(`Failed to load translations for ${lang}:`, error.message);
        translations[lang] = {};
    }
}

export function setLang(lang) {
    currentLang = lang;
    if (!translations[lang]) {
        loadTranslations(lang);
    }
}

export function t(key, args = {}) {
    const langTranslations = translations[currentLang] || translations['en'] || {};
    let translatedString = langTranslations[key] || key;

    // 如果是 panel.name 并且有自定义名称，则返回自定义名称
    if (key === 'panel.name') {
        if (panelSettings && panelSettings.panelName) {
            translatedString = panelSettings.panelName;
        }
    }

    for (const argKey in args) {
        translatedString = translatedString.replace(new RegExp(`{${argKey}}`, 'g'), args[argKey]);
    }

    return translatedString;
}

loadTranslations('en');

const i18n = { setLang, t, loadTranslations };
export default i18n;