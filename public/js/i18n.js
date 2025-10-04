const i18n = {
    translations: {}, // 初始为空，将从文件加载
    currentLang: 'auto', // 默认语言为自动检测

    loadTranslations: async function(langCode) {
        let langPath;
        if (langCode === 'auto') {
            const userLang = navigator.language || navigator.userLanguage;
            if (userLang.startsWith('zh')) {
                langPath = '/lang/zh_CN.json';
                this.currentLang = 'zh_CN';
            } else if (userLang.startsWith('ja')) {
                langPath = '/lang/jp.json';
                this.currentLang = 'jp';
            }
            else {
                langPath = '/lang/en.json'; // 默认英文
                this.currentLang = 'en';
            }
        } else {
            langPath = `/lang/${langCode}.json`;
            this.currentLang = langCode;
        }

        try {
            const response = await fetch(langPath);
            if (!response.ok) {
                throw new Error(`Failed to load translations from ${langPath}: ${response.statusText}`);
            }
            this.translations = await response.json();
            console.log('Translations loaded:', this.translations);
            // 更新HTML的lang属性
            document.documentElement.lang = this.currentLang.split('_')[0];
        } catch (error) {
            console.error('Error loading translations:', error);
            // Fallback to English if loading fails
            if (langCode !== 'en') {
                console.warn('Falling back to English translations.');
                await this.loadTranslations('en');
            }
        }
    },

    t: function(stringId, params = {}) {
        let message = this.translations[stringId] || stringId;

        // 替换格式化字符串
        for (const key in params) {
            if (params.hasOwnProperty(key)) {
                message = message.replace(new RegExp(`{${key}}`, 'g'), params[key]);
            }
        }
        return message;
    },

    // 替换 HTML 内容
    replaceHtmlContent: function() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const stringId = element.getAttribute('data-i18n');
            if (stringId) {
                // 检查元素是否有子元素，如果有，则在内部创建一个span来放置翻译文本
                if (element.children.length > 0) {
                    let span = element.querySelector('span.i18n-text');
                    if (!span) {
                        span = document.createElement('span');
                        span.classList.add('i18n-text');
                        // 将原始子元素移动到新创建的span之后，或者根据需要调整
                        // 这里假设data-i18n的元素内部只有一个文本节点或没有文本节点
                        // 如果有其他HTML，需要更复杂的处理
                        while (element.firstChild) {
                            span.appendChild(element.firstChild);
                        }
                        element.appendChild(span);
                    }
                    span.textContent = this.t(stringId);
                } else {
                    element.textContent = this.t(stringId);
                }
                // console.log('format', stringId, element.textContent);
                element.removeAttribute('data-i18n'); // 移除 data 标签，避免重复处理
            }
        });
    },

    saveLanguagePreference: function(langCode) {
        // 将语言代码保存到 cookie，有效期为一年
        document.cookie = `user_language=${langCode}; path=/; max-age=${365 * 24 * 60 * 60}`;
    },

    getLanguagePreference: function() {
        const name = 'user_language=';
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) === 0) {
                return c.substring(name.length, c.length);
            }
        }
        return null;
    },

    init: async function() {
        let preferredLang = this.getLanguagePreference();
        if (!preferredLang) {
            preferredLang = 'auto'; // 如果没有保存的语言，则自动检测
        }
        await this.loadTranslations(preferredLang);
        this.replaceHtmlContent(); // 初始加载后立即替换一次
        // 每隔一段时间检查并替换，以防动态内容加载
        setInterval(() => {
            this.replaceHtmlContent();
        }, 500); // 调整频率以适应应用需求
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();

    // 初始化语言选择下拉框
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
        // 设置当前选中的语言
        let currentDisplayLang = i18n.getLanguagePreference() || 'auto';
        languageSelect.value = currentDisplayLang;

        languageSelect.addEventListener('change', function() {
            const selectedLang = this.value;
            i18n.saveLanguagePreference(selectedLang);
            i18n.loadTranslations(selectedLang).then(() => {
                i18n.replaceHtmlContent();
            });
        });
    }

    // 保存语言按钮的事件监听器
    const saveLanguageBtn = document.getElementById('save-language-btn');
    if (saveLanguageBtn) {
        saveLanguageBtn.addEventListener('click', function() {
            const selectedLang = languageSelect.value;
            i18n.saveLanguagePreference(selectedLang);
            i18n.loadTranslations(selectedLang).then(() => {
                i18n.replaceHtmlContent();
                // 关闭模态框
                const changeLanguageModal = bootstrap.Modal.getInstance(document.getElementById('changeLanguageModal'));
                if (changeLanguageModal) {
                    changeLanguageModal.hide();
                }
            });
        });
    }
});