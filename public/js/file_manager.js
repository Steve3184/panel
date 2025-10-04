// 存储当前实例 ID 和当前路径
let monacoEditor = null;
let currentFileWs = null; // 用于文件编辑的 WebSocket 连接
let currentEditingFile = { instanceId: null, filePath: null };
let fileEditorModal = null; // Monaco Editor 模态框实例
let editingFilePathSpan = null; // Monaco Editor 文件路径显示元素
let editorStatusSpan = null; // Monaco Editor 状态显示元素

let currentInstanceId = null;
let currentPath = ''; // 相对于实例工作目录的路径

let selectedFile = null;
let uploadId = null;
let selectedFiles = new Set(); // 存储选中的文件路径

let clipboard = {
    operation: null, // 'copy' or 'cut'
    files: [] // 存储复制或剪切的文件路径
};


// 解压模态框相关元素
let extractFileModal = null;
let extractFileNameInput = null;
let extractDestinationPathInput = null;
let extractSubmitBtn = null;


// 文件后缀黑名单
const FILE_EDIT_BLACKLIST = [
    'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'xz', 'bz2', 'bzip2', 'zstd', 'jar', // 压缩文件
    'exe', 'dll', 'so', 'dylib', 'bin', // 可执行文件/二进制库
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'svg', 'ico', // 图片文件
    'mp3', 'wav', 'ogg', 'flac', 'aac', // 音频文件
    'mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv', // 视频文件
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', // 文档文件
    'sqlite', 'db', 'mdb', // 数据库文件
    'cer', 'crt', 'der', // 证书文件
    'bak', 'tmp', 'temp', // 临时备份文件
    'DS_Store', 'Thumbs.db', // 系统生成文件
];
// 文件类型图标映射
const fileIconMap = {
    // 文件夹
    'directory': 'bi bi-folder-fill',
    // 常见代码文件
    'js': 'bi bi-file-earmark-code-fill text-warning',
    'ts': 'bi bi-file-earmark-code-fill text-info',
    'json': 'bi bi-file-earmark-code-fill text-secondary',
    'html': 'bi bi-filetype-html text-danger',
    'css': 'bi bi-filetype-css text-info',
    'scss': 'bi bi-filetype-scss text-pink',
    'py': 'bi bi-filetype-py text-success',
    'java': 'bi bi-filetype-java text-danger',
    'rb': 'bi bi-filetype-ruby text-danger',
    'php': 'bi bi-filetype-php text-primary',
    'sh': 'bi bi-terminal-fill text-success',
    'yml': 'bi bi-filetype-yml text-secondary',
    'yaml': 'bi bi-filetype-yaml text-secondary',
    'xml': 'bi bi-file-earmark-code-fill text-secondary',
    // 文档文件
    'txt': 'bi bi-file-earmark-text-fill text-muted',
    'log': 'bi bi-file-earmark-text-fill text-muted',
    'md': 'bi bi-file-earmark-richtext-fill text-info',
    'pdf': 'bi bi-filetype-pdf text-danger',
    // 图片文件
    'png': 'bi bi-filetype-png text-primary',
    'jpg': 'bi bi-filetype-jpg text-info',
    'jpeg': 'bi bi-filetype-jpg text-info',
    'gif': 'bi bi-filetype-gif text-warning',
    'svg': 'bi bi-filetype-svg text-muted',
    // 压缩文件
    'zip': 'bi bi-file-earmark-zip-fill text-warning',
    'rar': 'bi bi-file-earmark-zip-fill text-warning',
    '7z': 'bi bi-file-earmark-zip-fill text-warning',
    'tar': 'bi bi-file-earmark-zip-fill text-warning',
    'gz': 'bi bi-file-earmark-zip-fill text-warning',
    'tgz': 'bi bi-file-earmark-zip-fill text-warning',
    'xz': 'bi bi-file-earmark-zip-fill text-warning',
    'bz2': 'bi bi-file-earmark-zip-fill text-warning',
    'bzip2': 'bi bi-file-earmark-zip-fill text-warning',
    'jar': 'bi bi-file-earmark-zip-fill text-warning',
    'zstd': 'bi bi-file-earmark-zip-fill text-warning',
    // 视频文件
    'mp4': 'bi bi-filetype-mp4 text-danger',
    'mkv': 'bi bi-filetype-video text-danger',
    'avi': 'bi bi-filetype-video text-danger',
    // 音频文件
    'mp3': 'bi bi-filetype-mp3 text-warning',
    'wav': 'bi bi-filetype-audio text-warning',
    // 配置文件
    'ini': 'bi bi-file-earmark-text text-muted',
    'cfg': 'bi bi-file-earmark-text text-muted',
    'conf': 'bi bi-file-earmark-text text-muted',
    'properties': 'bi bi-file-earmark-text text-muted',
    // 默认图标
    'default': 'bi bi-file-earmark'
};

function getFileIconClass(fileName, isDirectory) {
    if (isDirectory) {
        return fileIconMap['directory'];
    }
    const parts = fileName.split('.');
    const extension = parts.length > 1 ? parts.pop().toLowerCase() : '';
    return fileIconMap[extension] || fileIconMap['default'];
}

// Helper function to format file size
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 文件管理页面容器
const fileManagerPage = document.getElementById('file-manager-page');

function getMonacoLanguage(fileName) {
    const parts = fileName.split('.');
    const extension = parts.length > 1 ? parts.pop().toLowerCase() : '';
    switch (extension) {
        case 'js': return 'javascript';
        case 'ts': return 'typescript';
        case 'json': return 'json';
        case 'html': return 'html';
        case 'css': return 'css';
        case 'scss': return 'scss';
        case 'less': return 'less';
        case 'py': return 'python';
        case 'java': return 'java';
        case 'c': return 'c';
        case 'cpp': return 'cpp';
        case 'go': return 'go';
        case 'rb': return 'ruby';
        case 'php': return 'php';
        case 'sh': return 'shell';
        case 'yml':
        case 'yaml': return 'yaml';
        case 'xml': return 'xml';
        case 'md': return 'markdown';
        case 'txt': return 'plaintext';
        case 'bz2': return 'plaintext'; // bz2 也是二进制文件，但为了避免编辑黑名单，暂时设为纯文本
        default: return 'plaintext';
    }
}


function openFileWs(instanceId, filePath) {
    if (currentFileWs) {
        currentFileWs.close(); // 关闭现有连接
    }

    const wsUrl = `ws://${window.location.host}/ws`;
    currentFileWs = new WebSocket(wsUrl);

    currentFileWs.onopen = () => {
        console.log(i18n.t('files.edit.ws_connected'));
        editorStatusSpan.textContent = i18n.t('files.edit.connected');
        const subscribeMessage = {
            type: 'subscribe-file-edit',
            instanceId: instanceId,
            filePath: filePath
        };
        currentFileWs.send(JSON.stringify(subscribeMessage));
    };

    currentFileWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file-content-updated' && msg.filePath === currentEditingFile.filePath) {
            // 如果是后端推送的文件内容更新，更新编辑器
            const currentContent = monacoEditor.getValue();
            if (currentContent !== msg.content) {
                // 仅当内容不同时才更新，避免循环
                monacoEditor.setValue(msg.content);
                editorStatusSpan.textContent = i18n.t('files.edit.status_saved');
            }
        } else if (msg.type === 'file-saved-notification' && msg.filePath === currentEditingFile.filePath) {
            editorStatusSpan.textContent = i18n.t('files.edit.status_saved');
            if (msg.closeEditor) { // 如果后端通知需要关闭编辑器
                fileEditorModal.hide();
            }
        }
    };

    currentFileWs.onclose = () => {
        console.log(i18n.t('files.edit.ws_closed'));
        editorStatusSpan.textContent = i18n.t('files.edit.ws_closed');
    };

    currentFileWs.onerror = (error) => {
        console.error(i18n.t('files.edit.ws_error'), error);
        editorStatusSpan.textContent = i18n.t('files.edit.ws_error');
        showToast(i18n.t('files.edit.ws_error_hint'), 'danger');
    };
}

// 重命名模态框相关元素
let renameModal = null;
let renameOldPathInput = null;
let renameNewNameInput = null;
let renameSubmitBtn = null;

// 通用删除确认模态框
let deleteModal = null;
let confirmDeleteBtn = null;
let deleteMessage = null;
let deleteCallback = null;

// 辅助函数：模拟 Node.js 的 path.basename
function basename(path) {
    return path.split('/').reverse()[0];
}

// 辅助函数：模拟 Node.js 的 path.dirname
function dirname(path) {
    try {
        const parts = path.split('/');
        parts.pop(); // 移除最后一个元素（文件名或最后一个目录）
        return parts.join('/');
    } catch {
        return '';
    }
    
}

function updateBreadcrumb(filePath) {
    const breadcrumb = document.getElementById('path-breadcrumb');
    breadcrumb.innerHTML = '';

    const homeItem = document.createElement('li');
    homeItem.className = 'breadcrumb-item';
    homeItem.innerHTML = `<a href="#" data-path="">${i18n.t('files.home')}</a>`;
    homeItem.querySelector('a').addEventListener('click', (e) => {
        e.preventDefault();
        currentPath = '';
        loadFiles(currentInstanceId, currentPath);
    });
    breadcrumb.appendChild(homeItem);

    if (filePath) {
        const parts = filePath.split('/');
        let currentSegments = [];
        parts.forEach((part, index) => {
            currentSegments.push(part);
            const item = document.createElement('li');
            item.className = 'breadcrumb-item';
            if (index === parts.length - 1) {
                item.classList.add('active');
                item.setAttribute('aria-current', 'page');
                item.textContent = part;
            } else {
                item.innerHTML = `<a href="#" data-path="${currentSegments.join('/')}">${part}</a>`;
                item.querySelector('a').addEventListener('click', (e) => {
                    e.preventDefault();
                    currentPath = e.target.dataset.path;
                    loadFiles(currentInstanceId, currentPath);
                });
            }
            breadcrumb.appendChild(item);
        });
    }
}

function showDeleteConfirmModal(itemsToDelete, callback) {
    const deleteItemNameSpan = document.getElementById('delete-item-name');
    const confirmDeleteMessage = document.getElementById('confirm-delete-message');
    const deleteFileListContainer = document.getElementById('delete-file-list-container');
    const deleteFileList = document.getElementById('delete-file-list');
    const deleteItemNameParagraph = deleteItemNameSpan ? deleteItemNameSpan.closest('p') : null;

    // 重置显示状态
    if (deleteItemNameParagraph) deleteItemNameParagraph.classList.remove('d-none');
    if (confirmDeleteMessage) confirmDeleteMessage.classList.remove('d-none');
    if (deleteFileListContainer) deleteFileListContainer.classList.add('d-none');
    if (deleteFileList) deleteFileList.innerHTML = ''; // 清空列表

    if (deleteMessage && deleteItemNameSpan) {
        let messageText = '';
        let itemName = '';

        if (Array.isArray(itemsToDelete) && itemsToDelete.length > 1) {
            messageText = i18n.t('confirm.delete.multiple', { count: itemsToDelete.length });
            confirmDeleteMessage.textContent = messageText;

            if (deleteItemNameParagraph) deleteItemNameParagraph.classList.add('d-none'); // 隐藏单个项目名称
            if (deleteFileListContainer) deleteFileListContainer.classList.remove('d-none'); // 显示文件列表容器

            itemsToDelete.forEach(itemPath => {
                const fileName = basename(itemPath);
                let displayFileName = fileName;
                if (fileName.length > 50) {
                    displayFileName = '...' + fileName.substring(fileName.length - 47); // 截断并前置...
                }
                const listItem = document.createElement('li');
                listItem.className = 'list-group-item';
                listItem.textContent = displayFileName;
                deleteFileList.appendChild(listItem);
            });

        } else if (Array.isArray(itemsToDelete) && itemsToDelete.length === 1) {
            // messageText = i18n.t('confirm.delete');
            messageText = '';
            itemName = basename(itemsToDelete[0]);
            confirmDeleteMessage.textContent = messageText;
            deleteItemNameSpan.textContent = itemName;
        } else if (typeof itemsToDelete === 'string') {
            // messageText = i18n.t('confirm.delete');
            messageText = '';
            itemName = basename(itemsToDelete);
            confirmDeleteMessage.textContent = messageText;
            deleteItemNameSpan.textContent = itemName;
        } else {
            // messageText = i18n.t('confirm.delete');
            messageText = '';
            confirmDeleteMessage.textContent = messageText;
            deleteItemNameSpan.textContent = ''; // 确保没有旧的名称残留
        }
    }
    deleteCallback = callback;
    if (deleteModal) {
        deleteModal.show();
    } else {
        showToast(i18n.t('error.delete_modal_init'), 'danger');
    }
}


function initFileManager() {
    // 初始化重命名模态框
    renameModal = new bootstrap.Modal(document.getElementById('renameModal'));
    renameOldPathInput = document.getElementById('rename-old-path');
    renameNewNameInput = document.getElementById('rename-new-name');
    renameSubmitBtn = document.getElementById('rename-submit-btn');

    // 监听窗口resize事件，动态调整文件名宽度
    window.addEventListener('resize', adjustFileNameWidth);

    // 初始化解压模态框
    extractFileModal = new bootstrap.Modal(document.getElementById('extractFileModal'));
    extractFileNameInput = document.getElementById('extract-file-name');
    extractDestinationPathInput = document.getElementById('extract-destination-path');
    extractSubmitBtn = document.getElementById('extract-submit-btn');

    // 初始化压缩模态框相关元素
    const compressFilesModal = new bootstrap.Modal(document.getElementById('compressFilesModal'));
    const compressOutputNameInput = document.getElementById('compress-output-name');
    const compressFormatSelect = document.getElementById('compress-format');
    const compressLevelSlider = document.getElementById('compress-level-slider');
    const compressLevelDisplay = document.getElementById('compress-level-display');
    const compressSubmitBtn = document.getElementById('compress-submit-btn');
    const compressOutputExtensionDisplay = document.getElementById('compress-output-extension-display');

    // 更新压缩输出文件扩展名显示
    function updateCompressOutputExtensionDisplay() {
        const format = compressFormatSelect.value;
        let extension = format;
        if (format === 'tar.gz' || format === 'tar.xz' || format === 'tar.bz2') {
            extension = format; // 保持完整后缀
        }
        // compressOutputExtensionDisplay.setAttribute('data-i18n', `compress.extension.hint.${extension}`);
    }

    // 选区操作相关元素
    const selectionActionsDropdown = document.getElementById('selection-actions-dropdown');
    const copySelectedBtn = document.getElementById('copy-selected-btn');
    const cutSelectedBtn = document.getElementById('cut-selected-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const pasteBtn = document.getElementById('paste-btn');

    // 选区操作相关元素


    // 初始化通用删除确认模态框
    const modalElement = document.getElementById('confirmDeleteModal');
    if (modalElement) {
        deleteModal = window.globalState.modals.confirmDelete;
        confirmDeleteBtn = document.getElementById('confirm-delete-btn');
        deleteMessage = document.getElementById('confirm-delete-message');

        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => {
                if (deleteCallback) {
                    deleteCallback();
                }
                deleteModal.hide();
            });
        }
    }


    // 重命名表单提交事件
    renameSubmitBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const oldPath = renameOldPathInput.value;
        const newName = renameNewNameInput.value.trim();
        if (newName) {
            await renameFileOrFolder(currentInstanceId, oldPath, newName);
            renameModal.hide();
        } else {
            showToast(i18n.t('files.rename.empty_name_toast'), 'warning');
        }
    });

    // 复制按钮事件
    copySelectedBtn.addEventListener('click', () => {
        if (selectedFiles.size > 0) {
            clipboard.operation = 'copy';
            clipboard.files = Array.from(selectedFiles);
            showToast(i18n.t('files.copy.items_success', { count: clipboard.files.length }), 'info');
            selectedFiles.clear(); // 清空当前选中
            updateFileSelectionUI(); // 更新UI以隐藏选中的文件和操作按钮
        }
    });

    // 剪切按钮事件
    cutSelectedBtn.addEventListener('click', () => {
        if (selectedFiles.size > 0) {
            clipboard.operation = 'cut';
            clipboard.files = Array.from(selectedFiles);
            showToast(i18n.t('files.cut.items_success', { count: clipboard.files.length }), 'info');
            selectedFiles.clear(); // 清空当前选中
            updateFileSelectionUI(); // 更新UI以隐藏选中的文件和操作按钮
        }
    });

    // 多文件删除按钮事件
    deleteSelectedBtn.addEventListener('click', () => {
        if (selectedFiles.size > 0) {
            showDeleteConfirmModal(Array.from(selectedFiles), async () => {
                await deleteMultipleFilesOrFolders(currentInstanceId, Array.from(selectedFiles));
                selectedFiles.clear(); // 清空选中
                updateFileSelectionUI(); // 更新UI
                loadFiles(currentInstanceId, currentPath); // 刷新文件列表
            });
        }
    });

    // 粘贴按钮事件
    pasteBtn.addEventListener('click', async () => {
        if (!clipboard.operation || clipboard.files.length === 0) {
            showToast(i18n.t('files.paste.clipboard_empty_toast'), 'warning');
            return;
        }

        const operationType = clipboard.operation;
        const filesToPaste = clipboard.files;
        const destination = currentPath; // 粘贴到当前目录

        try {
            if (operationType === 'copy') {
                await performCopy(currentInstanceId, filesToPaste, destination);
                showToast(i18n.t('files.paste.copy_success', { count: filesToPaste.length }), 'success');
            } else if (operationType === 'cut') {
                await performMove(currentInstanceId, filesToPaste, destination);
                showToast(i18n.t('files.paste.move_success', { count: filesToPaste.length }), 'success');
            }
        } catch (error) {
            console.error(i18n.t('files.paste.operation_failed_console'), error);
            showToast(i18n.t('files.paste.operation_failed_toast', { message: error.message }), 'danger');
        } finally {
            clipboard.operation = null; // 清空剪贴板
            clipboard.files = [];
            updateFileSelectionUI(); // 更新UI
            loadFiles(currentInstanceId, currentPath); // 刷新文件列表
        }
    });


    // 压缩模态框显示前，初始化默认值
    document.getElementById('compressFilesModal').addEventListener('show.bs.modal', () => {
        let defaultOutputName = 'selected_files';
        if (selectedFiles.size === 1) {
            const filePath = Array.from(selectedFiles)[0];
            defaultOutputName = basename(filePath).split('.').slice(0, -1).join('.'); // 移除后缀
            if (!defaultOutputName) { // 如果是纯文件名没有后缀
                defaultOutputName = basename(filePath);
            }
        }
        compressOutputNameInput.value = defaultOutputName;
        compressFormatSelect.value = 'zip'; // 默认zip
        compressLevelSlider.value = '5'; // 默认压缩比5
        compressLevelDisplay.textContent = '5'; // 更新显示
        updateCompressOutputExtensionDisplay();
    });

    // 压缩格式选择变化时，更新输出文件名后缀提示
    compressFormatSelect.addEventListener('change', updateCompressOutputExtensionDisplay);



    // 压缩比滑块变化时，更新显示
    compressLevelSlider.addEventListener('input', () => {
        compressLevelDisplay.textContent = compressLevelSlider.value;
    });

    // 压缩提交按钮事件监听器
    compressSubmitBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const outputNameWithoutExtension = compressOutputNameInput.value.trim();
        const format = compressFormatSelect.value;
        const level = parseInt(compressLevelSlider.value, 10);

        if (!outputNameWithoutExtension) {
            showToast(i18n.t('files.compress.empty_name_toast'), 'warning');
            return;
        }

        const fullOutputName = `${outputNameWithoutExtension}.${format}`;
        const filesToCompressArray = Array.from(selectedFiles);

        await performCompress(currentInstanceId, filesToCompressArray, currentPath, fullOutputName, format, level);
        compressFilesModal.hide(); // 隐藏模态框
    });


    // 事件监听器
    document.getElementById('refresh-files-btn').addEventListener('click', () => {
        if (currentInstanceId) {
            loadFiles(currentInstanceId, currentPath);
        }
    });

    // 解压提交按钮事件监听器 (在各个文件行的解压按钮点击时设置 data-file-path)
    extractSubmitBtn.addEventListener('click', async () => {
        const fileToExtractPath = extractFileNameInput.dataset.filePath; // 从 data-filePath 获取原始文件路径
        if (!fileToExtractPath) {
            showToast(i18n.t('files.extract.no_file_toast'), 'danger');
            return;
        }

        const destinationPath = extractDestinationPathInput.value.trim();
        await performExtract(currentInstanceId, fileToExtractPath, destinationPath);
        extractFileModal.hide();
    });

    // 获取新建文件/文件夹模态框相关元素
    const createNewModal = new bootstrap.Modal(document.getElementById('createNewModal'));
    const createNewModalLabel = document.getElementById('createNewModalLabel');
    const newNameInput = document.getElementById('new-name-input');
    const newNameLabel = document.querySelector('#create-new-form label[for="new-name-input"]');
    const createNewSubmitBtn = document.getElementById('create-new-submit-btn');

    let createNewType = ''; // 'folder' 或 'file'

    document.getElementById('new-folder-btn').addEventListener('click', () => {
        createNewType = 'folder';
        createNewModalLabel.textContent = i18n.t('files.new.folder');
        newNameLabel.textContent = i18n.t('files.new.folder.name');
        newNameInput.value = ''; // 清空输入框
        createNewModal.show();
    });

    document.getElementById('new-file-btn').addEventListener('click', () => {
        createNewType = 'file';
        createNewModalLabel.textContent = i18n.t('files.new.file');
        newNameLabel.textContent = i18n.t('files.new.file.name');
        newNameInput.value = ''; // 清空输入框
        createNewModal.show();
    });

    createNewSubmitBtn.addEventListener('click', async (e) => { // 添加 async 和 e 参数
        e.preventDefault(); // 阻止表单默认提交行为
        const name = newNameInput.value.trim();
        if (name) {
            // 使用 await 确保异步操作完成后再隐藏模态框和刷新列表
            if (createNewType === 'folder') {
                await createFolder(currentInstanceId, currentPath, name);
            } else if (createNewType === 'file') {
                await createNewFile(currentInstanceId, currentPath, name);
            }
            createNewModal.hide(); // 隐藏模态框
            // loadFiles(currentInstanceId, currentPath); // 在 createFolder 和 createNewFile 内部已调用，无需重复
        } else {
            showToast(i18n.t('files.create.name_cannot_be_empty_toast'), 'warning');
        }
    });

    // 返回实例列表按钮的事件监听器
    document.getElementById('back-to-instances-btn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('file-browser').classList.add('d-none');
        document.getElementById('file-manager-instance-list').classList.remove('d-none');
        document.getElementById('back-to-instances-btn').style.display = 'none'; // 隐藏返回按钮
        document.getElementById('file-manager-header').classList.add('d-none'); // 隐藏文件管理头部
        // 还需要清除当前实例和路径，以便下次进入文件管理时重新加载实例列表
        currentInstanceId = null;
        currentPath = '';
        selectedFiles.clear(); // 清空选中的文件
        clipboard = { operation: null, files: [] }; // 重置剪贴板
        updateFileSelectionUI(); // 更新UI
    });

    // 获取文件上传模态框相关元素
    const uploadFileModal = document.getElementById('uploadFileModal');
    const uploadCurrentPathSpan = document.getElementById('upload-current-path');
    const fileInput = document.getElementById('file-input');
    const dropArea = document.getElementById('drop-area');
    const uploadProgressBar = document.getElementById('upload-progress-bar');
    const uploadStatus = document.getElementById('upload-status');
    const startUploadBtn = document.getElementById('start-upload-btn');
    const uploadCancelBtn = document.getElementById('upload-cancel-btn');


    // 打开上传模态框时更新当前路径
    uploadFileModal.addEventListener('show.bs.modal', () => {
        uploadCurrentPathSpan.textContent = currentPath === '' ? i18n.t('files.home') : currentPath;
        resetUploadModal();
    });

    // 文件选择事件
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            selectedFile = e.target.files[0]; // 修改顶层声明的 selectedFile
            uploadStatus.textContent = i18n.t('files.upload.file_selected_status', { fileName: selectedFile.name, fileSize: (selectedFile.size / (1024 * 1024)).toFixed(2) });
            startUploadBtn.disabled = false;
        } else {
            selectedFile = null;
            uploadStatus.textContent = '';
            startUploadBtn.disabled = true;
        }
    });

    // 拖拽事件
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('border-primary'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('border-primary'), false);
    });

    dropArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            fileInput.files = files; // 将拖放的文件设置到文件输入框
            fileInput.dispatchEvent(new Event('change')); // 触发 change 事件
        }
    }, false);

    startUploadBtn.addEventListener('click', startUpload);
    uploadCancelBtn.addEventListener('click', () => {
        // TODO: 取消上传逻辑，如果正在进行中
        resetUploadModal();
    });

    // Monaco Editor 相关逻辑
    initializeMonacoEditor(); // 初始化 Monaco Editor

    // 辅助函数：根据文件扩展名获取 Monaco Editor 语言模式
    function resetUploadModal() {
        selectedFile = null;
        uploadId = null;
        fileInput.value = '';
        uploadProgressBar.style.width = '0%';
        uploadProgressBar.setAttribute('aria-valuenow', 0);
        uploadProgressBar.textContent = '0%';
        uploadProgressBar.parentElement.classList.add('d-none');
        uploadStatus.textContent = '';
        startUploadBtn.disabled = true;
        uploadCancelBtn.textContent = i18n.t('cancel');
        dropArea.classList.remove('border-primary'); // 移除拖拽时的蓝色边框
    }

    function initializeMonacoEditor() {
        fileEditorModal = new bootstrap.Modal(document.getElementById('fileEditorModal'));
        editingFilePathSpan = document.getElementById('editing-file-path');
        editorStatusSpan = document.getElementById('editor-status');
        const saveFileBtn = document.getElementById('save-file-btn'); // 原来的“保存”按钮
        const saveAndCloseFileBtn = document.getElementById('save-and-close-file-btn'); // 新增的“保存并关闭”按钮

        // 确保按钮文本正确
        saveFileBtn.textContent = i18n.t('save');

        require.config({ paths: { 'vs': '/cdn/jsdelivr/monaco-editor@0.41.0/min/vs' } });
        require(['vs/editor/editor.main'], () => {
            monacoEditor = monaco.editor.create(document.getElementById('editor-container'), {
                value: '',
                language: 'plaintext', // 默认语言
                theme: 'vs-dark', // 默认主题
                automaticLayout: true, // 自动布局
                minimap: { enabled: false }, // 禁用小地图
                readOnly: true // 默认只读，加载内容后再设置为可写
            });

            let saveTimeout;
            const autoSaveDelay = 3 * 1000; // 3 秒

            // 监听编辑器内容变化，并发送到 WebSocket (用于实时更新，但不再自动保存)
            monacoEditor.onDidChangeModelContent(() => {
                editorStatusSpan.textContent = i18n.t('files.edit.status_unsaved'); // 立即显示未保存状态

                // 清除之前的定时器
                clearTimeout(saveTimeout);

                // 设置新的定时器
                saveTimeout = setTimeout(() => {
                    if (currentFileWs && currentFileWs.readyState === WebSocket.OPEN) {
                        const content = monacoEditor.getValue();
                        currentFileWs.send(JSON.stringify({
                            type: 'save-file',
                            instanceId: currentEditingFile.instanceId,
                            filePath: currentEditingFile.filePath,
                            content: content
                        }));
                        editorStatusSpan.textContent = i18n.t('files.edit.status_autosaving');
                    }
                }, autoSaveDelay);
            });

            // “保存”按钮点击事件 (仅保存，不关闭)
            saveFileBtn.addEventListener('click', () => {
                clearTimeout(saveTimeout); // 点击保存时取消自动保存计时器
                if (currentFileWs && currentFileWs.readyState === WebSocket.OPEN) {
                    const content = monacoEditor.getValue();
                    currentFileWs.send(JSON.stringify({
                        type: 'save-file',
                        instanceId: currentEditingFile.instanceId,
                        filePath: currentEditingFile.filePath,
                        content: content
                    }));
                    editorStatusSpan.textContent = i18n.t('files.edit.status_manual_saving');
                }
            });

            // “保存并关闭”按钮点击事件
            saveAndCloseFileBtn.addEventListener('click', () => {
                clearTimeout(saveTimeout); // 点击保存时取消自动保存计时器
                if (currentFileWs && currentFileWs.readyState === WebSocket.OPEN) {
                    const content = monacoEditor.getValue();
                    currentFileWs.send(JSON.stringify({
                        type: 'save-file',
                        instanceId: currentEditingFile.instanceId,
                        filePath: currentEditingFile.filePath,
                        content: content,
                        closeEditor: true // 添加一个标志，表示保存后关闭编辑器
                    }));
                    editorStatusSpan.textContent = i18n.t('files.edit.manualsaving');
                }
            });

            // 监听 Ctrl+S 快捷键
            document.addEventListener('keydown', (e) => {
                // 只有当文件编辑器模态框显示时才响应
                if (fileEditorModal._element.classList.contains('show')) {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault(); // 阻止浏览器默认的保存行为
                        saveFileBtn.click(); // 触发“保存”按钮的点击事件 (仅保存)
                    }
                }
            });
        });

        // 监听文件编辑模态框关闭事件
        fileEditorModal._element.addEventListener('hidden.bs.modal', () => {
            // 清理状态和 WebSocket 连接
            if (currentFileWs) {
                currentFileWs.close(); // 关闭现有连接
            }
            currentEditingFile = { instanceId: null, filePath: null };
            if (monacoEditor) { // 检查 monacoEditor 是否已初始化
                monacoEditor.setValue('');
                monacoEditor.updateOptions({ readOnly: true });
            }
            editingFilePathSpan.textContent = ''; // 清理路径显示
            editorStatusSpan.textContent = ''; // 清理状态显示
        });
    }

    // 文件上传核心逻辑
    async function startUpload() {
        if (!selectedFile || !currentInstanceId) {
            showToast(i18n.t('files.upload.select_file_instance_toast'), 'danger');
            return;
        }

        startUploadBtn.disabled = true;
        uploadCancelBtn.textContent = i18n.t('files.upload.cancel_button');
        uploadProgressBar.parentElement.classList.remove('d-none');
        uploadStatus.textContent = i18n.t('files.upload.initializing_status');

        const chunkSize = 10 * 1024 * 1024; // 10MB chunks
        let offset = 0;

        try {
            // Step 1: Init upload
            const initResponse = await fetch(`/api/instances/${currentInstanceId}/upload/init`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fileName: selectedFile.name,
                    fileSize: selectedFile.size,
                    targetDirectory: currentPath
                })
            });

            if (!initResponse.ok) {
                const errorData = await initResponse.json();
                throw new Error(errorData.message || i18n.t('files.upload.init_failed_error'));
            }
            const initData = await initResponse.json();
            uploadId = initData.uploadId;
            showToast(i18n.t('files.upload.init_success_toast'), 'success');

            // Step 2: Upload chunks
            while (offset < selectedFile.size) {
                const chunk = selectedFile.slice(offset, offset + chunkSize);
                const formData = new FormData();
                formData.append('uploadId', uploadId);
                formData.append('chunk', chunk);
                formData.append('chunkIndex', offset / chunkSize);
                formData.append('offset', offset);

                const chunkResponse = await fetch(`/api/instances/${currentInstanceId}/upload/chunk`, {
                    method: 'POST',
                    body: formData
                });

                if (!chunkResponse.ok) {
                    const errorData = await chunkResponse.json();
                    throw new Error(errorData.message || i18n.t('files.upload.chunk_failed_error'));
                }

                offset += chunk.size;
                const progress = (offset / selectedFile.size) * 100;
                uploadProgressBar.style.width = `${progress.toFixed(2)}%`;
                uploadProgressBar.setAttribute('aria-valuenow', progress.toFixed(2));
                uploadProgressBar.textContent = `${progress.toFixed(2)}%`;
                uploadStatus.textContent = i18n.t('files.upload.uploading_status', { uploaded: formatBytes(offset), total: formatBytes(selectedFile.size) });
            }

            // Step 3: Complete upload
            const completeResponse = await fetch(`/api/instances/${currentInstanceId}/upload/complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    uploadId: uploadId,
                    fileName: selectedFile.name,
                    fileSize: selectedFile.size,
                    destinationPath: currentPath // 再次确认目标路径
                })
            });

            if (!completeResponse.ok) {
                const errorData = await completeResponse.json();
                throw new Error(errorData.message || i18n.t('files.upload.complete_failed_error'));
            }

            showToast(i18n.t('files.upload.success_toast'), 'success');
            resetUploadModal();
            loadFiles(currentInstanceId, currentPath); // 刷新文件列表
            bootstrap.Modal.getInstance(document.getElementById('uploadFileModal')).hide(); // 关闭模态框

        } catch (error) {
            console.error(i18n.t('files.upload.failed_console'), error);
            showToast(i18n.t('files.upload.failed_toast', { message: error.message }), 'danger');
            startUploadBtn.disabled = false;
            uploadCancelBtn.textContent = i18n.t('cancel');
            uploadStatus.textContent = i18n.t('files.upload.failed_status', { message: error.message });
            uploadProgressBar.parentElement.classList.add('d-none');
        }
    }
}

// 在 DOMContentLoaded 之外添加搜索框事件监听器，避免重复绑定
document.addEventListener('DOMContentLoaded', () => {
    const fileSearchInput = document.getElementById('file-search-input');
    if (fileSearchInput) {
        fileSearchInput.addEventListener('input', () => {
            if (currentInstanceId) {
                loadFiles(currentInstanceId, currentPath);
            }
        });
    }
});


// 执行解压操作
async function performExtract(instanceId, filePath, destinationPath) {
    try {
        // 发送解压请求，后端会立即返回 202 Accepted，并在后台处理解压
        const response = await fetch(`/api/instances/${instanceId}/extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filePath, destinationPath })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '解压请求失败');
        }

        // 立即显示请求已发送的提示，不等待解压完成
        showToast(i18n.t('files.extract.request_sent_toast'), 'info');
        extractFileModal.hide(); // 隐藏模态框
        selectedFiles.clear(); // 清空选中
        // 不再立即刷新文件列表，等待 WebSocket 通知

    } catch (error) {
        console.error(i18n.t('files.extract.request_failed_console'), error);
        showToast(i18n.t('files.extract.request_failed_toast', { message: error.message }), 'danger');
    }
}

// 执行压缩操作
async function performCompress(instanceId, filesToCompress, destinationPath, outputName, format, level) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/compress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filesToCompress, destinationPath, outputName, format, level })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '压缩失败');
        }

        showToast(data.message || i18n.t('files.compress.request_sent_toast'), 'info');
        selectedFiles.clear(); // 清空选中
        // 不再立即刷新文件列表，等待 WebSocket 通知

    } catch (error) {
        console.error(i18n.t('files.compress.operation_failed_console'), error);
        showToast(i18n.t('files.compress.operation_failed_toast', { message: error.message }), 'danger');
    }
}


// 在DOMContentLoaded事件监听器之外定义openFileInEditor
async function openFileInEditor(instanceId, filePath, fileName) {
    const fileExtension = fileName.split('.').pop().toLowerCase();
    const MAX_EDIT_SIZE_MB = 2; // 最大编辑文件大小，单位MB
    const MAX_EDIT_SIZE_BYTES = MAX_EDIT_SIZE_MB * 1024 * 1024;

    if (FILE_EDIT_BLACKLIST.includes(fileExtension)) {
        showToast(i18n.t('files.edit.unsupported_file_type_toast', { fileExtension: fileExtension }), 'warning');
        return;
    }

    try {
        const encodedPath = encodeURIComponent(filePath);
        // 首先获取文件信息，检查大小
        const fileInfoResponse = await fetch(`/api/instances/${instanceId}/files/${encodedPath}`);
        if (!fileInfoResponse.ok) {
            const errorData = await fileInfoResponse.json();
            throw new Error(errorData.message);
        }
        const fileInfo = await fileInfoResponse.json();

        if (fileInfo.size > MAX_EDIT_SIZE_BYTES) {
            showToast(i18n.t('files.edit.file_too_large_toast', { maxSize: MAX_EDIT_SIZE_MB }), 'warning');
            return;
        }

        const response = await fetch(`/api/instances/${instanceId}/file-content/${encodedPath}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message);
        }
        const { content } = await response.json();

        editingFilePathSpan.textContent = filePath;
        monacoEditor.setValue(content);
        monacoEditor.updateOptions({ readOnly: false }); // 设置为可写
        monaco.editor.setModelLanguage(monacoEditor.getModel(), getMonacoLanguage(fileName));

        currentEditingFile = { instanceId, filePath };

        // 建立 WebSocket 连接
        openFileWs(instanceId, filePath);

        fileEditorModal.show();
    } catch (error) {
        console.error(i18n.t('files.edit.open_file_failed_console'), error);
        showToast(i18n.t('files.edit.open_file_failed_toast', { message: error.message }), 'danger');
    }
}

async function loadInstancesForFileManager() {
    try {
        const response = await fetch(`/api/instances`);
        const instances = await response.json();
        const instanceSelectList = document.getElementById('instance-select-list');
        instanceSelectList.innerHTML = ''; // 清空现有列表

        if (instances.length === 0) {
            instanceSelectList.innerHTML = `<p class="text-muted">${i18n.t('files.instance.no_instances_found')}</p>`;
            return;
        }

        instances.forEach(instance => {
            const instanceItem = document.createElement('a');
            instanceItem.href = '#';
            instanceItem.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
            instanceItem.innerHTML = `
                <div>
                    <i class="bi bi-server me-2"></i> ${instance.name}
                    <span class="badge ms-2 ${instance.status === 'running' ? 'bg-success' : 'bg-secondary'}">${instance.status === 'running' ? i18n.t('instances.status.running') : i18n.t('instances.status.stopped')}</span>
                </div>
            `;
            instanceItem.addEventListener('click', (e) => {
                e.preventDefault();
                currentInstanceId = instance.id;
                currentPath = ''; // 重置路径
                selectedFiles.clear(); // 清空选中的文件
                clipboard = { operation: null, files: [] }; // 重置剪贴板
                updateFileSelectionUI(); // 更新UI

                document.getElementById('file-manager-instance-list').classList.add('d-none'); // 隐藏实例列表
                document.getElementById('file-browser').classList.remove('d-none'); // 显示文件浏览器
                document.getElementById('back-to-instances-btn').style.display = 'block'; // 显示返回按钮
                document.getElementById('file-manager-header').classList.remove('d-none'); // 显示文件管理头部 (包括上传按钮)
                loadFiles(currentInstanceId, currentPath);
            });
            instanceSelectList.appendChild(instanceItem);
        });
    } catch (error) {
        console.error(i18n.t('files.instance.load_instances_failed_console'), error);
        showToast(i18n.t('files.instance.load_instances_failed_toast', { message: error.message }), 'danger');
    }
}

async function loadFiles(instanceId, filePath) {
    try {
        const encodedPath = encodeURIComponent(filePath);
        const response = await fetch(`/api/instances/${instanceId}/files/${encodedPath}`);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message);
        }
        let files = await response.json(); // 使用 let 允许重新赋值

        // 获取搜索框的值
        const searchInput = document.getElementById('file-search-input');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

        // 过滤文件列表
        if (searchTerm) {
            files = files.filter(file => file.name.toLowerCase().includes(searchTerm));
        }

        const fileListBody = document.getElementById('file-list-body');
        fileListBody.innerHTML = ''; // 清空现有列表

        // 添加返回上一级目录的选项
        if (filePath !== '') {
            const parentPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
            const row = fileListBody.insertRow();
            row.innerHTML = `
                <td></td> <!-- Checkbox column -->
                <td><i class="bi bi-folder-fill ms-1 me-2"></i> ..</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            `;
            row.dataset.path = parentPath; // Add data-path to the row
            row.classList.add('file-row'); // Add class for styling and event delegation
            row.addEventListener('dblclick', (e) => { // Double click to go up
                e.preventDefault();
                currentPath = row.dataset.path; // Use the path from the row's dataset
                loadFiles(currentInstanceId, currentPath);
            });
        }

        files.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        files.forEach(file => {
            const row = fileListBody.insertRow();
            const iconClass = getFileIconClass(file.name, file.isDirectory); // 使用辅助函数获取图标
            const sizeDisplay = file.isFile ? formatBytes(file.size) : ''; // 使用 formatBytes
            const mtime = shouldHideModificationTime() ? '' : new Date(file.mtime).toLocaleString(); // 根据条件设置mtime
            const fileExtension = file.isFile ? file.name.split('.').pop().toLowerCase() : '';
            const canEdit = file.isFile && !FILE_EDIT_BLACKLIST.includes(fileExtension);

            const checkboxId = `checkbox-${file.path.replace(/[^a-zA-Z0-9]/g, '_')}`; // 为ID生成安全的字符串
            const isSelected = selectedFiles.has(file.path);

            row.innerHTML = `
                <td><input type="checkbox" class="file-checkbox" id="${checkboxId}" data-path="${file.path}" ${isSelected ? 'checked' : ''}></td>
                <td><label for="${checkboxId}" class="mb-0" style="cursor: pointer;"><i class="${iconClass} ms-1 me-2"></i> <span class="file-name-display" title="${file.name}">${file.name}</span></label></td>
                <td>${file.isDirectory ? i18n.t('files.type.folder') : i18n.t('files.type.file')}</td>
                <td>${sizeDisplay}</td>
                <td>${mtime}</td>
                <td class="file-actions">
                    ${file.isFile ? `<button class="btn btn-sm btn-primary download-file-btn" data-path="${file.path}"><i class="bi bi-download me-1"></i><span>${i18n.t('files.action.download')}</span></button>` : ''}
                    ${file.isFile && ['zip', '7z', 'gz', 'tgz', 'xz', 'bz2'].includes(fileExtension)
                    ? `<button class="btn btn-sm btn-secondary extract-file-btn ms-2" data-path="${file.path}" data-name="${file.name}"><i class="bi bi-box-arrow-in-down-right me-1"></i><span>${i18n.t('files.action.extract')}</span></button>`
                    : (canEdit ? `<button class="btn btn-sm btn-info edit-file-btn ms-2" data-path="${file.path}" data-name="${file.name}"><i class="bi bi-pencil-square me-1"></i><span>${i18n.t('files.action.edit')}</span></button>` : '')
                }
                    <button class="btn btn-sm btn-warning rename-file-btn${file.isDirectory ? '' : ' ms-2'}" data-path="${file.path}" data-name="${file.name}" data-is-directory="${file.isDirectory}"><i class="bi bi-pencil me-1"></i><span>${i18n.t('files.action.rename')}</span></button>
                    <button class="btn btn-sm btn-danger delete-file-btn ms-2" data-path="${file.path}"><i class="bi bi-trash me-1"></i><span>${i18n.t('files.action.delete')}</span></button>
                </td>
            `;

            row.dataset.path = file.path; // Add data-path to the row
            row.dataset.name = file.name; // Add file name to the row
            row.dataset.isDirectory = file.isDirectory; // Add directory status to the row
            row.classList.add('file-row'); // Add a common class for all file/folder rows

            // 单击事件：选中/取消选中文件
            row.addEventListener('click', (e) => {
                // 如果点击目标是操作按钮或复选框本身，则不阻止默认行为或改变选中状态
                if (e.target.closest('.delete-file-btn') || e.target.closest('.download-file-btn') || e.target.closest('.edit-file-btn') || e.target.classList.contains('file-checkbox') || e.target.closest('.extract-file-btn')) {
                    // 让事件继续传播到按钮的监听器
                    return;
                }

                const checkbox = row.querySelector('.file-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked; // 切换复选框状态
                    toggleFileSelection(checkbox.dataset.path, checkbox.checked);
                }
            });

            // 双击事件：打开文件夹或编辑文件
            row.addEventListener('dblclick', (e) => {
                e.preventDefault();
                // 确保双击不会触发操作按钮的二次点击
                if (e.target.closest('.btn')) {
                    return;
                }

                if (file.isDirectory) {
                    currentPath = row.dataset.path;
                    loadFiles(currentInstanceId, currentPath);
                } else {
                    window.openFileInEditor(currentInstanceId, file.path, file.name);
                }
            });

            // 复选框自身的点击事件，处理选中逻辑
            const checkbox = row.querySelector('.file-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    toggleFileSelection(e.target.dataset.path, e.target.checked);
                });
            }

            // 操作按钮的事件监听器保持不变，但要阻止事件冒泡到行，以避免干扰单击和双击事件
            const actionButtons = row.querySelectorAll('.btn');
            actionButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    e.stopPropagation(); // 阻止事件冒泡到行
                });
            });

            // 为下载按钮添加事件监听器
            const downloadBtn = row.querySelector('.download-file-btn');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', (e) => {
                    const downloadUrl = `/api/instances/${currentInstanceId}/download/${encodeURIComponent(file.path)}`;
                    window.open(downloadUrl, '_blank');
                    showToast(i18n.t('files.download.downloading_file_toast', { fileName: file.name }), 'info');
                });
            }

            // 为编辑按钮添加事件监听器 (如果存在)
            const editBtn = row.querySelector('.edit-file-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    window.openFileInEditor(currentInstanceId, file.path, file.name);
                });
            }

            // 为解压按钮添加事件监听器 (如果存在)
            const extractBtn = row.querySelector('.extract-file-btn');
            if (extractBtn) {
                extractBtn.addEventListener('click', (e) => {
                    const filePathToExtract = e.target.dataset.path || e.target.parentElement.dataset.path;
                    const fileNameToExtract = e.target.dataset.name || e.target.parentElement.dataset.name;

                    extractFileNameInput.value = fileNameToExtract;
                    extractFileNameInput.dataset.filePath = filePathToExtract; // 将完整路径存储在 dataset 中
                    extractDestinationPathInput.value = dirname(filePathToExtract); // 默认解压到文件所在目录
                    extractFileModal.show();
                });
            }

            // 无论文件夹还是文件，都为删除按钮添加事件监听器
            const deleteBtn = row.querySelector('.delete-file-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    showDeleteConfirmModal(file.path, () => { // 传递单个文件路径字符串
                        deleteFileOrFolder(currentInstanceId, file.path);
                    });
                });
            }

            // 为重命名按钮添加事件监听器
            const renameBtn = row.querySelector('.rename-file-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', (e) => {
                    const currentFileName = file.name;
                    renameOldPathInput.value = file.path; // 保存旧路径
                    renameNewNameInput.value = currentFileName; // 预填旧名称
                    renameModal.show(); // 显示重命名模态框
                });
            }
        });

        updateBreadcrumb(filePath);
        updateSelectAllCheckboxState(); // 更新全选复选框状态
        updateFileSelectionUI(); // 显式调用以确保UI同步
        adjustFileNameWidth(); // 调整文件名显示宽度

    } catch (error) {
        console.error(i18n.t('files.load.failed_console'), error);
        showToast(i18n.t('files.load.failed_toast', { message: error.message }), 'danger');
        // 如果出错，返回实例选择界面
        document.getElementById('file-browser').classList.add('d-none');
        document.getElementById('file-manager-instance-list').classList.remove('d-none');
    }
}

// 动态调整文件名显示宽度
function adjustFileNameWidth() {
    const fileBrowser = document.getElementById('file-browser');
    if (!fileBrowser) return;

    // 获取文件浏览器内容区域的宽度
    const contentWidth = fileBrowser.offsetWidth;
    const maxFileNameWidth = Math.floor(contentWidth / 4); // 1/3 宽度

    document.querySelectorAll('.file-name-display').forEach(element => {
        element.style.maxWidth = `${maxFileNameWidth}px`;
    });
}

async function createFolder(instanceId, parentPath, folderName) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/files/${encodeURIComponent(parentPath)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: folderName })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message);
        }
 
        showToast(i18n.t('files.create.folder_success_toast', { folderName: folderName }), 'success');
        loadFiles(instanceId, parentPath); // 刷新文件列表
    } catch (error) {
        console.error(i18n.t('files.create.folder_failed_console'), error);
        showToast(i18n.t('files.create.folder_failed_toast', { message: error.message }), 'danger');
    }
}

async function renameFileOrFolder(instanceId, oldPath, newName) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/rename`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ oldPath, newName })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message);
        }
 
        showToast(i18n.t('files.rename.success_toast', { oldName: basename(oldPath), newName: newName }), 'success');
        loadFiles(instanceId, dirname(oldPath)); // 刷新当前目录
    } catch (error) {
        console.error(i18n.t('files.rename.failed_console'), error);
        showToast(i18n.t('files.rename.failed_toast', { message: error.message }), 'danger');
    }
}

async function createNewFile(instanceId, parentPath, fileName) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/files/${encodeURIComponent(parentPath)}`, {
            method: 'PUT', // 使用 PUT 方法创建新文件
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: fileName, content: '' }) // 新文件通常是空的
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message);
        }
 
        showToast(i18n.t('files.create.file_success_toast', { fileName: fileName }), 'success');
        loadFiles(instanceId, parentPath); // 刷新文件列表
    } catch (error) {
        console.error(i18n.t('files.create.file_failed_console'), error);
        showToast(i18n.t('files.create.file_failed_toast', { message: error.message }), 'danger');
    }
}

async function deleteFileOrFolder(instanceId, filePath) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/files/${encodeURIComponent(filePath)}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message);
        }
 
        showToast(i18n.t('files.delete.success_toast', { fileName: basename(filePath) }), 'success');
        loadFiles(instanceId, dirname(filePath)); // 刷新文件列表
    } catch (error) {
        console.error(i18n.t('files.delete.failed_console'), error);
        showToast(i18n.t('files.delete.failed_toast', { message: error.message }), 'danger');
    }
}

// 执行复制操作
async function performCopy(instanceId, filesToCopy, destinationPath) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/copy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ files: filesToCopy, destination: destinationPath })
        });

        const data = await response.json();
 
        if (!response.ok) {
            throw new Error(data.message || i18n.t('files.copy.operation_failed_error'));
        }
 
        return data; // 返回成功信息
    } catch (error) {
        console.error(i18n.t('files.copy.operation_failed_console'), error);
        throw error;
    }
}

// 执行移动（剪切）操作
async function performMove(instanceId, filesToMove, destinationPath) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/move`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ files: filesToMove, destination: "./" + destinationPath })
        });

        const data = await response.json();
 
        if (!response.ok) {
            throw new Error(data.message || i18n.t('files.move.operation_failed_error'));
        }
 
        return data; // 返回成功信息
    } catch (error) {
        console.error(i18n.t('files.move.operation_failed_console'), error);
        throw error;
    }
}

// 执行多文件/文件夹删除操作
async function deleteMultipleFilesOrFolders(instanceId, filePaths) {
    try {
        const response = await fetch(`/api/instances/${instanceId}/delete-multiple`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filePaths: filePaths })
        });

        const data = await response.json();
 
        if (!response.ok) {
            throw new Error(data.message || i18n.t('files.delete.bulk_failed_error'));
        }
 
        return data; // 返回成功信息
    } catch (error) {
        console.error(i18n.t('files.delete.bulk_failed_console'), error);
        throw error;
    }
}


// 将 showFileManager 函数暴露给全局
window.showFileManager = () => {
    fileManagerPage.classList.remove('d-none');
    // 初始进入文件管理器时，只显示实例列表，头部（包括上传按钮）默认隐藏
    document.getElementById('file-manager-header').classList.add('d-none');
    document.getElementById('file-browser').classList.add('d-none'); // 确保文件浏览器也是隐藏的
    document.getElementById('file-manager-instance-list').classList.remove('d-none'); // 显示实例列表
    document.getElementById('back-to-instances-btn').style.display = 'none'; // 隐藏返回按钮
    loadInstancesForFileManager();
};



// WebSocket 消息处理函数
function handleFileManagerWebSocketMessage(msg) {
    // 根据消息类型处理文件管理相关事件
    switch (msg.type) {
        case 'file-change': // 文件或目录发生变化
            if (msg.instanceId === currentInstanceId && (msg.path === currentPath || dirname(msg.path) === currentPath || (clipboard.operation && clipboard.files.some(f => dirname(f) === msg.path)))) {
                if (msg.details) {
                    showToast(i18n.t('files.notification.file_system_change_toast', { details: msg.details }), 'info');
                }
                loadFiles(currentInstanceId, currentPath); // 刷新当前目录
            }
            break;
        case 'upload-progress': // 文件上传进度（如果需要后端推送，目前前端已处理）
            // 可以选择在这里更新 UI，但目前前端已自行处理进度条
            // console.log(`Upload progress for ${msg.fileName}: ${msg.progress}%`);
            break;
        case 'upload-complete-notification': // 文件上传完成通知
            // 检查上传的文件路径是否与当前显示的目录匹配
            // msg.filePath 现在是相对于实例工作目录的路径
            const uploadedFileDir = dirname(msg.filePath);
            if (msg.instanceId === currentInstanceId && uploadedFileDir === currentPath) {
                showToast(i18n.t('files.notification.upload_complete_toast', { fileName: msg.fileName }), 'success');
                loadFiles(currentInstanceId, currentPath); // 刷新当前目录
            }
            break;
        case 'file-delete-notification': // 文件删除通知
            if (msg.instanceId === currentInstanceId && (msg.path === currentPath || dirname(msg.path) === currentPath)) {
                showToast(i18n.t('files.notification.file_delete_toast', { fileName: basename(msg.path) }), 'info');
                loadFiles(currentInstanceId, currentPath); // 刷新当前目录
            }
            break;
        case 'folder-create-notification': // 文件夹创建通知
            if (msg.instanceId === currentInstanceId && (msg.path === currentPath || dirname(msg.path) === currentPath)) {
                showToast(i18n.t('files.notification.folder_create_toast', { folderName: basename(msg.path) }), 'info');
                loadFiles(currentInstanceId, currentPath); // 刷新当前目录
            }
            break;
        case 'file-extract-status': // 文件解压状态通知
            if (msg.instanceId === currentInstanceId) {
                if (msg.status === 'success') {
                    showToast(i18n.t('files.notification.extract_success_toast', { fileName: msg.fileName, destinationPath: msg.destinationPath }), 'success');
                    // 如果解压目标路径是当前路径或其子路径，则刷新文件列表
                    if (msg.destinationPath === currentPath || msg.destinationPath.startsWith(currentPath + '/')) {
                        loadFiles(currentInstanceId, currentPath);
                    }
                } else {
                    showToast(i18n.t('files.notification.extract_failed_toast', { fileName: msg.fileName, message: msg.message }), 'danger');
                }
            }
            break;
        case 'file-compress-status': // 文件压缩状态通知
            if (msg.instanceId === currentInstanceId) {
                if (msg.status === 'success') {
                    showToast(i18n.t('files.notification.compress_success_toast', { fileName: basename(msg.outputName), destinationPath: msg.destinationPath }), 'success');
                    // 如果压缩目标路径是当前路径或其子路径，则刷新文件列表
                    if (msg.destinationPath === currentPath || msg.destinationPath.startsWith(currentPath + '/')) {
                        loadFiles(currentInstanceId, currentPath);
                    }
                } else {
                    showToast(i18n.t('files.notification.compress_failed_toast', { fileName: basename(msg.outputName), message: msg.message }), 'danger');
                }
            }
            break;
    }
}

// 在文件管理器页面加载时注册 WebSocket 处理器，在离开时注销
document.addEventListener('DOMContentLoaded', () => {
    // 确保 main.js 已经加载并暴露了 registerWebSocketHandler
    if (typeof window.registerWebSocketHandler === 'function') {
        window.registerWebSocketHandler('file-manager', handleFileManagerWebSocketMessage);
    } else {
        console.warn(i18n.t('files.notification.websocket_handler_not_defined_warning'));
    }
});

// 当页面被隐藏（即切换到其他页面）时注销处理器，避免不必要的处理
// 注意：这里依赖 main.js 中 hideAllPages 的行为，如果 main.js 切换页面时，fileManagerPage 会被加上 d-none
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
            const isHidden = fileManagerPage.classList.contains('d-none');
            if (isHidden && typeof window.unregisterWebSocketHandler === 'function') {
                // 如果文件管理器页面隐藏，注销 WebSocket 处理器
                window.unregisterWebSocketHandler('file-manager');
            } else if (!isHidden && typeof window.registerWebSocketHandler === 'function') {
                // 如果文件管理器页面显示，重新注册 WebSocket 处理器
                window.registerWebSocketHandler('file-manager', handleFileManagerWebSocketMessage);
            }
        }
    });
});

// 观察 fileManagerPage 元素的 class 属性变化
observer.observe(fileManagerPage, { attributes: true });


// Helper function to manage selected files
function toggleFileSelection(filePath, isSelected) {
    if (isSelected) {
        selectedFiles.add(filePath);
    } else {
        selectedFiles.delete(filePath);
    }
    updateSelectAllCheckboxState();
    updateFileSelectionUI(); // 更新所有相关的UI
}

// Helper function to update the state of the "select all" checkbox
function updateSelectAllCheckboxState() {
    const selectAllCheckbox = document.getElementById('select-all-files');
    if (!selectAllCheckbox) return;

    const allFileCheckboxes = document.querySelectorAll('.file-checkbox');
    if (allFileCheckboxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    const allChecked = Array.from(allFileCheckboxes).every(cb => cb.checked);
    const anyChecked = Array.from(allFileCheckboxes).some(cb => cb.checked);

    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = !allChecked && anyChecked;
    // 移除此处对 updateFileSelectionUI() 的调用，避免循环和冗余
}

// "Select All" checkbox event listener
document.addEventListener('DOMContentLoaded', () => {
    const selectAllCheckbox = document.getElementById('select-all-files');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const allFileCheckboxes = document.querySelectorAll('.file-checkbox');

            if (isChecked) {
                allFileCheckboxes.forEach(checkbox => {
                    selectedFiles.add(checkbox.dataset.path);
                });
            } else {
                selectedFiles.clear();
            }
            updateFileSelectionUI();
            updateSelectAllCheckboxState(); // Re-evaluate the state of the select-all checkbox itself
        });
    }
});

// Helper function to update the visibility of various buttons based on selection and clipboard
function updateFileSelectionUI() {
    const compressButton = document.getElementById('compress-selected-btn');
    const selectionActionsDropdown = document.getElementById('selection-actions-dropdown');
    const pasteButton = document.getElementById('paste-btn');

    // 控制选区操作下拉框的可见性
    if (selectedFiles.size > 0) {
        selectionActionsDropdown.classList.remove('d-none');
    } else {
        selectionActionsDropdown.classList.add('d-none');
    }

    // 控制粘贴按钮的可见性
    if (clipboard.operation && clipboard.files.length > 0) {
        pasteButton.classList.remove('d-none');
    } else {
        pasteButton.classList.add('d-none');
    }

    // 更新所有文件行的复选框状态
    document.querySelectorAll('.file-checkbox').forEach(checkbox => {
        const filePath = checkbox.dataset.path;
        checkbox.checked = selectedFiles.has(filePath);
    });
}

// 判断是否应该隐藏“修改时间”列
function shouldHideModificationTime() {
    const body = document.body;
    const screenWidth = window.innerWidth;
    // 当屏幕宽度小于等于 768px 且侧边栏折叠时隐藏
    return screenWidth <= 1000;
}
