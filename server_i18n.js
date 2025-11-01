const fs = require('fs');
const path = require('path');

const translations = {};
let currentLang = 'en'; // Default language

function loadTranslations(lang) {
    const langFilePath = path.join(__dirname, 'frontend', 'public', 'lang', `${lang}.json`);
    try {
        const data = fs.readFileSync(langFilePath, 'utf8');
        translations[lang] = JSON.parse(data);
        console.log(`Loaded translations for ${lang}`);
    } catch (error) {
        console.error(`Failed to load translations for ${lang}:`, error.message);
        translations[lang] = {}; // Fallback to empty object
    }
}

function setLang(lang) {
    currentLang = lang;
    if (!translations[lang]) {
        loadTranslations(lang);
    }
}

function t(key, args = {}) {
    const langTranslations = translations[currentLang] || translations['en'] || {};
    let translatedString = langTranslations[key] || key; // Fallback to key if not found

    // Replace placeholders
    for (const argKey in args) {
        translatedString = translatedString.replace(new RegExp(`{${argKey}}`, 'g'), args[argKey]);
    }

    return translatedString;
}

// Load default languages on startup
loadTranslations('en');

module.exports = {
    setLang,
    t,
    loadTranslations // Expose for potential dynamic loading
};