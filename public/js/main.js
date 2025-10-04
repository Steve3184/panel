document.addEventListener('DOMContentLoaded', () => {

    // =================================================================
    // STATE MANAGEMENT
    // =================================================================
    const state = {
        instances: [],
        users: [], // New state for users
        currentUser: null,
        activeInstanceId: null,
        activeTerminal: null, // { xterm, fitAddon }
        activePage: 'overview', // 'overview', 'instance', 'users', 'file-manager'
        modals: {}, // To hold bootstrap modal instances
        searchTerm: '', // New property for search functionality
        filteredInstances: [], // New property to store filtered instances
        fullOverviewRenderNeeded: true, // Flag to indicate if full overview render is needed
        websocketMessageHandlers: new Map(), // New: Map to store WebSocket message handlers from other modules
        activeToasts: new Map(), // New: Map to store active toast instances for progress updates
    };
    window.globalState = state;

    // =================================================================
    // DOM ELEMENT CACHING
    // =================================================================
    const dom = {
        sidebar: document.querySelector('.sidebar'),
        sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
        sidebarCloseBtn: document.getElementById('sidebar-close-btn'),
        mainContent: document.getElementById('main-content'),
        overviewPage: document.getElementById('overview-page'),
        instancePage: document.getElementById('instance-page'),
        usersPage: document.getElementById('users-page'), // New: Users management page
        pageTitle: document.getElementById('page-title'),
        instancePageTitle: document.getElementById('instance-page-title'), // New: Instance page title
        sidebarInstanceList: document.getElementById('instance-list-sidebar'),
        usernameDisplay: document.getElementById('username-display'),
        logoutBtn: document.getElementById('logout-btn'), // Still needed for logout action
        instanceStatsBadge: document.getElementById('instance-stats-badge'),
        terminalContainer: document.getElementById('terminal-container'),
        instanceActionButtons: document.getElementById('instance-action-buttons'),
        createInstanceForm: document.getElementById('create-instance-form'),
        settingsInstanceForm: document.getElementById('settings-instance-form'),
        createInstanceEnv: document.getElementById('create-instance-env'), // New
        settingsInstanceEnv: document.getElementById('settings-instance-env'), // New
        
        // New: Auto-restart checkbox
        settingsAutoRestart: document.getElementById('settings-autorestart'),

        // Command input fields and labels
        createInstanceCommand: document.getElementById('create-instance-command'),
        createInstanceCommandLabel: document.getElementById('create-instance-command-label'),
        settingsInstanceCommand: document.getElementById('settings-instance-command'),
        settingsInstanceCommandLabel: document.getElementById('settings-instance-command-label'),

        // User dropdown elements
        userInfoDropdown: document.getElementById('user-info-dropdown'),
        userDropdownMenuButton: document.getElementById('user-dropdown-menu-button'),
        changePasswordDropdownItem: document.getElementById('change-password-dropdown-item'),

        // Docker specific elements for human-friendly editor
        editPortsBtn: document.getElementById('edit-ports-btn'),
        createDockerPortsDisplay: document.getElementById('create-docker-ports-display'),
        createDockerPortsHidden: document.getElementById('create-docker-ports-hidden'),
        editVolumesBtn: document.getElementById('edit-volumes-btn'),
        createDockerVolumesDisplay: document.getElementById('create-docker-volumes-display'),
        createDockerVolumesHidden: document.getElementById('create-docker-volumes-hidden'),

        editSettingsPortsBtn: document.getElementById('edit-settings-ports-btn'),
        settingsDockerPortsDisplay: document.getElementById('settings-docker-ports-display'),
        settingsDockerPortsHidden: document.getElementById('settings-docker-ports-hidden'),
        editSettingsVolumesBtn: document.getElementById('edit-settings-volumes-btn'),
        settingsDockerVolumesDisplay: document.getElementById('settings-docker-volumes-display'),
        settingsDockerVolumesHidden: document.getElementById('settings-docker-volumes-hidden'),

        portList: document.getElementById('port-list'),
        addPortBtn: document.getElementById('add-port-btn'),
        savePortsBtn: document.getElementById('save-ports-btn'),

        // New: Port and Volume Modals specific elements
        portListEditor: document.getElementById('port-list-editor'),
        addPortRowBtn: document.getElementById('add-port-row-btn'),
        savePortsBtn: document.getElementById('save-ports-btn'),
        volumeListEditor: document.getElementById('volume-list-editor'),
        addVolumeRowBtn: document.getElementById('add-volume-row-btn'),
        saveVolumesBtn: document.getElementById('save-volumes-btn'),

        // User management elements
        adminUsersLinkContainer: document.getElementById('admin-users-link-container'),
        adminUsersLink: document.getElementById('admin-users-link'),
        userSearchInput: document.getElementById('user-search-input'), // New: User search input
        userTableBody: document.getElementById('user-table-body'),
        createUserForm: document.getElementById('create-user-form'), // Corrected ID
        createUsername: document.getElementById('create-username'),
        createPassword: document.getElementById('create-password'),
        createUserRole: document.getElementById('create-role'),
        editPermissionsUsername: document.getElementById('edit-permissions-username'),
        editPermissionsUserId: document.getElementById('edit-permissions-userid'),
        editPermissionsRole: document.getElementById('edit-permissions-role'), // New: Role selection for user permissions
        instancePermissionsContainer: document.getElementById('instance-permissions-container'), // New: Container for instance permissions
        instancePermissionsList: document.getElementById('instance-permissions-list'),
        confirmDeleteUserName: document.getElementById('confirm-delete-user-name'),
        confirmDeleteUserBtn: document.getElementById('confirm-delete-user-btn'),
        changePasswordUserId: document.getElementById('change-password-userid'), // Hidden field to store userId for change password modal
        changePasswordUsernameDisplay: document.getElementById('change-password-username-display'), // Display username in change password modal
        oldPasswordInput: document.getElementById('old-password'), // New: Old password input field

        // Confirmation Modal elements
        confirmDeleteModal: document.getElementById('confirmDeleteModal'),
        confirmDeleteMessage: document.getElementById('confirm-delete-message'),
        confirmDeleteBtn: document.getElementById('confirm-delete-btn'),

        // Docker specific elements (Create Modal)
        createInstanceType: document.getElementById('create-instance-type'),
        dockerSettingsCreate: document.getElementById('docker-settings-create'),
        createDockerImage: document.getElementById('create-docker-image'),
        createDockerContainerName: document.getElementById('create-docker-container-name'),
        createDockerPorts: document.getElementById('create-docker-ports'),
        createDockerVolumes: document.getElementById('create-docker-volumes'),
        createDockerWorkingDir: document.getElementById('create-docker-working-dir'),
        createDockerCommand: document.getElementById('create-docker-command'),

        // Docker specific elements (Settings Modal)
        dockerSettingsSettings: document.getElementById('docker-settings-settings'),
        settingsDockerImage: document.getElementById('settings-docker-image'),
        settingsDockerContainerName: document.getElementById('settings-docker-container-name'),
        settingsDockerPorts: document.getElementById('settings-docker-ports'),
        settingsDockerVolumes: document.getElementById('settings-docker-volumes'),
        settingsDockerWorkingDir: document.getElementById('settings-docker-working-dir'),
        settingsDockerCommand: document.getElementById('settings-docker-command'),

        // Edit Username Modal elements
        editUsernameModal: document.getElementById('editUsernameModal'),
        editUsernameDisplay: document.getElementById('edit-username-display'),
        editUsernameUserId: document.getElementById('edit-username-userid'),
        editUsernameInput: document.getElementById('edit-username-input'),
        editUsernameForm: document.getElementById('edit-username-form'),

        fileManagerLink: document.getElementById('file-manager-link'),
    };

    // =================================================================
    // UTILITY FUNCTIONS
    // =================================================================
    function parseEnvString(envString) {
        const env = {};
        envString.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine) {
                const parts = trimmedLine.split('=');
                if (parts.length >= 2) {
                    const key = parts[0];
                    const value = parts.slice(1).join('=');
                    env[key] = value;
                }
            }
        });
        return env;
    }

    function formatEnvObject(envObject) {
        return Object.entries(envObject).map(([key, value]) => `${key}=${value}`).join('\n');
    }

    function parseListString(listString) {
        return listString.split('\n').map(line => line.trim()).filter(line => line !== '');
    }

    function formatListObject(listArray) {
        return listArray ? listArray.join('\n') : '';
    }

    function parsePortString(portString) {
        // Example: "80:80/tcp", "443:443/udp", "8080:8080", "22"
        const parts = portString.split(':');
        let hostPort = '';
        let containerPort = '';
        let protocol = 'tcp'; // Default protocol is TCP
 
        if (parts.length === 2) {
            hostPort = parts[0];
            const containerParts = parts[1].split('/');
            containerPort = containerParts[0];
            if (containerParts.length === 2) {
                protocol = containerParts[1];
            }
        } else if (parts.length === 1) {
            // If only one part, assume it's container port and host port is ephemeral or same
            // For Docker, if only "PORT", it maps container to ephemeral host port
            // But for explicit mapping, we need both. If only one given, assume hostPort and containerPort are the same
            hostPort = parts[0];
            containerPort = parts[0];
        } else {
            // Invalid format
            return null;
        }
 
        // Handle "tcp+udp" merging. When parsing, if we find "tcp+udp", we should return an object
        // that indicates this combined protocol. Later, when saving, this should be split into two.
        // For the purpose of displaying in the modal, we treat it as one entry.
        // The splitting happens in savePorts()
        return { hostPort: hostPort ? parseInt(hostPort) : '', containerPort: containerPort ? parseInt(containerPort) : '', protocol };
    }
 
    function formatPortObject(port) {
        // When formatting, if protocol is 'tcp' and 'udp' it should be `host:container/tcp+udp` for display,
        // but when saving to the backend, it should be split into two separate entries.
        // This function is mainly for displaying in the main form.
        // For display in the main form, we need to handle the case where "tcp+udp" was originally merged.
        // The individual tcp/udp rules from the backend should be displayed as two separate rules for user editing,
        // but if they were originally from a "tcp+udp" input, we need to show them as combined.
        // This logic is primarily for `displayPorts` and `savePorts`.
        // Here, we just format a single port object.
        let formatted = `${port.hostPort}:${port.containerPort}`;
        if (port.protocol && port.protocol !== 'tcp') {
            formatted += `/${port.protocol}`;
        }
        return formatted;
    }
 
    function parseVolumeString(volumeString) {
        // Example: "/host/path:/container/path", "/host/path:/container/path:ro"
        const parts = volumeString.split(':');
        const source = parts[0];
        const destination = parts[1];
        const readOnly = parts.length === 3 && parts[2] === 'ro';
        return { source, destination, readOnly };
    }
 
    function formatVolumeObject(volume) {
        let formatted = `${volume.source}:${volume.destination}`;
        if (volume.readOnly) {
            formatted += ':ro';
        }
        return formatted;
    }

    // =================================================================
    // INITIALIZATION
    // =================================================================
    async function init() {
        try {
            const response = await fetch('/api/session');
            if (!response.ok) throw new Error();
            const sessionData = await response.json();
            state.currentUser = sessionData.user;
            dom.usernameDisplay.textContent = state.currentUser.username;
            
            // Show user management link if admin
            if (state.currentUser.role === 'admin') {
                dom.adminUsersLinkContainer.classList.remove('d-none');
            }

            // Set the dropdown button text
            // dom.userDropdownMenuButton.textContent = i18n.t('panel.greeting', { username: state.currentUser.username });

            state.modals.create = new bootstrap.Modal(document.getElementById('createInstanceModal'));
            state.modals.settings = new bootstrap.Modal(document.getElementById('settingsInstanceModal'));
            state.modals.confirmDelete = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));
            state.modals.createUser = new bootstrap.Modal(document.getElementById('createUserModal')); // User modal
            state.modals.editUserPermissions = new bootstrap.Modal(document.getElementById('editUserPermissionsModal')); // User permissions modal
            state.modals.confirmDeleteUser = new bootstrap.Modal(document.getElementById('confirmDeleteUserModal')); // Confirm delete user modal
            state.modals.changePassword = new bootstrap.Modal(document.getElementById('changePasswordModal')); // Change password modal
            state.modals.editUsername = new bootstrap.Modal(document.getElementById('editUsernameModal')); // New: Edit username modal
            state.modals.portForwarding = new bootstrap.Modal(document.getElementById('portForwardingModal')); // Port forwarding modal
            state.modals.volumeMounting = new bootstrap.Modal(document.getElementById('volumeMountingModal')); // Volume mounting modal
 
            setupWebSocket();
            await fetchInstances();
            // Ensure file manager functions are available if the script is loaded
            if (typeof window.showFileManager === 'function') {
                bindEventListeners();
            } else {
                console.warn('file_manager.js not loaded or showFileManager function not available.');
                // Fallback or retry mechanism if needed
            }
            render();
            updatePageTitle(); // Ensure the correct title is set after initial render
            // The bindEventListeners() call is already inside the if block above, remove redundant call
            // bindEventListeners();
            initFileManager();
            console.log('init ok!')
        } catch (error) {
            console.error("Initialization failed:", error);
            debugger;
            window.location.href = '/login.html';
        }
    }

    // =================================================================
    // API HELPERS
    // =================================================================
    async function fetchInstances() {
        try {
            const response = await fetch('/api/instances');
            if (!response.ok) {
                 const errorData = await response.json();
                 throw new Error(errorData.message || i18n.t('error.fetch_instances_failed'));
            }
            state.instances = await response.json();
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function fetchUsers() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) {
                 const errorData = await response.json();
                 throw new Error(errorData.message || i18n.t('error.fetch_users_failed'));
            }
            state.users = await response.json();
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function createUser(userData) {
        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || i18n.t('error.create_user_failed'));
            }
            showToast(i18n.t('success.user_create'), 'success'); // Use new showToast
            state.modals.createUser.hide();
            dom.createUserForm.reset();
            await fetchUsers(); // Refresh user list
            render();
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function deleteUser(userId) {
        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || i18n.t('error.delete_user_failed'));
            }
            showToast(i18n.t('success.user_delete'), 'success'); // Use new showToast
            state.modals.confirmDeleteUser.hide();
            await fetchUsers(); // Refresh user list
            await fetchInstances(); // Instances might have had permissions removed
            render();
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function updateUserPermission(instanceId, userId, terminalPermission, fileManagement) {
        try {
            const response = await fetch(`/api/instances/${instanceId}/permissions/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ terminalPermission, fileManagement }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || i18n.t('error.update_user_permission_failed'));
            }
            showToast(i18n.t('success.user_perms_update'), 'success'); // Use new showToast
            await fetchInstances(); // Refresh instances to get updated permissions
            // Note: openUserPermissionsModal is called below after individual permission changes, so no need here.
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function performInstanceAction(id, action) {
        try {
            const response = await fetch(`/api/instances/${id}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || i18n.t('error.action_failed', { action }));
            }
            showToast(i18n.t('success.action_initiated', { action }), 'success'); // Use new showToast
            if (state.activeInstanceId) {
                showInstance(state.activeInstanceId);
            }
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function createInstance(data) {
        try {
            const response = await fetch('/api/instances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || i18n.t('error.create_instance_failed'));
            }
            showToast(i18n.t('success.instance_create'), 'success'); // Use new showToast
            state.modals.create.hide();
            dom.createInstanceForm.reset();
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function updateInstance(id, data) {
        try {
            const response = await fetch(`/api/instances/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || i18n.t('error.update_instance_failed'));
            }
            showToast(i18n.t('success.instance_update'), 'success'); // Use new showToast
            state.modals.settings.hide();
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }
    
    async function deleteInstance(id, deleteData = true) {
         try {
            const url = `/api/instances/${id}?deleteData=${deleteData}`;
            const response = await fetch(url, { method: 'DELETE' });
            if (!response.ok) {
                 const err = await response.json();
                throw new Error(err.message || i18n.t('error.delete_instance_failed'));
            }
            showToast(i18n.t(deleteData ? 'success.instance_delete.all' : 'success.instance_delete.remove'), 'success'); // Use new showToast
            if (state.modals.settings) state.modals.settings.hide();
            state.modals.confirmDelete.hide(); // Hide the confirmation modal
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    // =================================================================
    // WEBSOCKET MANAGEMENT
    // =================================================================
    function setupWebSocket() {
        const protocol = (location.protocol === 'https:') ? 'wss://' : 'ws://';
        state.socket = new WebSocket(`${protocol}${location.host}/ws`);

        state.socket.onopen = () => {
            console.log(i18n.t('websocket.established'));
        };

        state.socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            // Iterate over registered message handlers
            for (const handler of state.websocketMessageHandlers.values()) {
                handler(msg);
            }

            switch (msg.type) {
                case 'event': handleWebSocketEvent(msg.event, msg); break;
                case 'system-stats': updateSystemStats(msg); break;
                case 'instance-stats': if (state.activeInstanceId === msg.id) updateInstanceStats(msg); break;
                case 'output': if (state.activeInstanceId === msg.id && state.activeTerminal) state.activeTerminal.xterm.write(msg.data); break;
                case 'file-extract-progress':
                    showToast(i18n.t('files.progress.extract', { fileName: msg.fileName }), 'info', msg.extractId, true, msg.progress);
                    break;
                case 'file-compress-progress':
                    showToast(i18n.t('files.progress.compress', { outputName: msg.outputName }), 'info', msg.compressId, true, msg.progress);
                    break;
                case 'file-extract-status':
                    if (msg.status === 'success') {
                        showToast(i18n.t('files.progress.extract.success', { fileName: msg.fileName }), 'success', msg.extractId, true, 100);
                    } else if (msg.status === 'failed') {
                        showToast(i18n.t('files.progress.extract.failed', { fileName: msg.fileName, error: msg.error }), 'danger', msg.extractId, true, 0);
                    }
                    break;
                case 'file-compress-status':
                    if (msg.status === 'success') {
                        showToast(i18n.t('files.progress.compress.success', { outputName: msg.outputName }), 'success', msg.compressId, true, 100);
                    } else if (msg.status === 'failed') {
                        showToast(i18n.t('files.progress.compress.failed', { outputName: msg.outputName, error: msg.error }), 'danger', msg.compressId, true, 0);
                    }
                    break;
            }
        };

        state.socket.onclose = () => {
            console.log(i18n.t('websocket.closed'));
            showToast(i18n.t('websocket.lost'), 'danger'); // Use new showToast
            setTimeout(setupWebSocket, 1000);
        };

        state.socket.onerror = (error) => {
            console.error('ws error:', error);
        };
    }
    
    function sendSocketMessage(message) {
        if (state.socket && state.socket.readyState === WebSocket.OPEN) {
            state.socket.send(JSON.stringify(message));
        }
    }

    function handleWebSocketEvent(eventName, data) {
        console.log(`event: ${eventName}`, data);
        const findInstance = (id) => state.instances.find(i => i.id === id);
        
        switch (eventName) {
            case 'instance-created': state.instances.push(data.instance); break;
            case 'instance-deleted':
                state.instances = state.instances.filter(i => i.id !== data.id);
                if (state.activeInstanceId === data.id) showOverview();
                break;
            case 'instance-updated':
                 const instanceIndex = state.instances.findIndex(i => i.id === data.instance.id);
                 if (instanceIndex !== -1) state.instances[instanceIndex] = { ...state.instances[instanceIndex], ...data.instance };
                 // Update activeInstanceId if current instance is updated (e.g., name changed)
                 if (state.activeInstanceId === data.instance.id) {
                     dom.instancePageTitle.textContent = data.instance.name;
                 }
                 break;
            case 'instance-started': {
                const i = findInstance(data.id);
                if (i) i.status = 'running';
                if (state.activeInstanceId === data.id) {
                    destroyTerminal(); // 强制销毁现有终端，以便重新创建和订阅
                    const updatedInstance = state.instances.find(inst => inst.id === data.id);
                    if (updatedInstance) {
                        createTerminal(updatedInstance); // 重新创建终端并订阅
                    }
                }
                break;
            }
            case 'instance-stopped': {
                const i = findInstance(data.id);
                if (i) i.status = 'stopped';
                if (state.activeInstanceId === data.id) {
                    destroyTerminal(); // 强制销毁现有终端
                    const updatedInstance = state.instances.find(inst => inst.id === data.id);
                    if (updatedInstance) {
                        createTerminal(updatedInstance); // 重新创建终端以显示停止状态或重新连接
                    }
                }
                break;
            }
        }
        render(); // Re-render the UI based on updated state
    }


    // =================================================================
    // UI RENDERING
    // =================================================================
    function render() {
        renderSidebar();
        switch (state.activePage) {
            case 'overview':
                renderOverview();
                break;
            case 'instance':
                renderInstancePage();
                break;
            case 'users':
                if (state.currentUser.role === 'admin') {
                    renderUsersPage();
                } else {
                    showOverview(); // Redirect to overview if not admin
                }
                break;
            case 'file-manager':
                // file_manager.js handles its own rendering
                break;
            default:
                showOverview();
        }
    }

    function renderSidebar() {
        dom.sidebarInstanceList.innerHTML = state.instances
            .map(instance => `
                <li class="nav-item">
                    <a class="nav-link d-flex justify-content-between align-items-center ${state.activeInstanceId === instance.id ? 'active' : ''}" href="#" data-action="show-instance" data-id="${instance.id}">
                        <span>
                            <i class="bi ${instance.type === 'docker' ? 'bi-box-seam' : 'bi-terminal'} me-2"></i>
                            ${instance.name}
                        </span>
                        <span class="badge ${instance.status === 'running' ? 'bg-success' : 'bg-secondary'}">${instance.status === 'running' ? i18n.t('instances.status.running') : i18n.t('instances.status.stopped')}</span>
                    </a>
                </li>
            `).join('');
    }

    function renderOverview() {
        filterInstances(); // Filter instances based on searchTerm

        // Only render the full overview page if it's not already rendered or if a full refresh is needed
        if (dom.overviewPage.innerHTML === '' || state.fullOverviewRenderNeeded) {
            dom.overviewPage.innerHTML = `
                <div class="row mb-4">
                    <div class="col-lg-6 mb-3">
                        <div class="card stat-card h-100">
                            <div class="card-body">
                                <h5 class="card-title" data-i18n="overview.cpu_usage">CPU</h5>
                                <p class="card-text fs-2" id="cpu-stat">--%</p>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-6 mb-3">
                        <div class="card stat-card h-100">
                            <div class="card-body">
                                <h5 class="card-title" data-i18n="overview.memory_usage">RAM</h5>
                                <p class="card-text fs-2" id="mem-stat">--/-- GB</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="d-flex mb-3">
                    <input type="text" class="form-control me-2" id="instance-search-input" value="${state.searchTerm}">
                    ${state.currentUser.role === 'admin' ? `
                    <button class="btn btn-primary flex-shrink-0" data-bs-toggle="modal" data-bs-target="#createInstanceModal">
                        <i class="bi bi-plus-lg me-2"></i><span data-i18n="instances.create"></span>
                    </button>
                    ` : ''}
                </div>
                <div id="instance-list-overview"></div>
            `;
            state.fullOverviewRenderNeeded = false; // Reset flag

            // Attach event listener for search input only once, it will be re-attached in showOverview
            const searchInput = document.getElementById('instance-search-input');
            if (searchInput) {
                // Ensure no duplicate listeners are added if renderOverview is called multiple times without full re-render
                searchInput.removeEventListener('input', handleSearchInput);
                searchInput.addEventListener('input', handleSearchInput);
            }
        }
        renderInstanceListOverview(); // Always render/update the instance list
    }

    function renderInstanceListOverview() {
        const instanceListOverview = document.getElementById('instance-list-overview');
        if (instanceListOverview) {
            instanceListOverview.innerHTML = state.filteredInstances.map(instance => `
                <div class="card mb-3">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center flex-wrap">
                            <div class="me-3 mb-2 mb-md-0">
                                <h5 class="card-title mb-1">
                                    <i class="bi ${instance.type === 'docker' ? 'bi-box-seam' : 'bi-terminal'} me-2"></i>
                                    ${instance.name}
                                </h5>
                                <span class="badge ${instance.status === 'running' ? 'bg-success' : 'bg-secondary'} me-2">${instance.status === 'running' ? i18n.t('instances.status.running') : i18n.t('instances.status.stopped')}</span>
                                <small class="text-muted"><code>${instance.type === 'docker' ? instance.dockerConfig?.image || instance.command : instance.command}</code></small>
                            </div>
                            <div class="btn-group">
                                <button class="btn btn-sm btn-outline-primary" data-action="show-instance" data-id="${instance.id}" data-i18n="open"></button>
                                ${state.currentUser.role === 'admin' || (instance.permissions?.[state.currentUser.id]?.terminal === 'full-control') ? `
                                <button class="btn btn-sm btn-outline-secondary" data-action="edit-instance" data-id="${instance.id}"><i class="bi bi-gear"></i></button>
                                ` : ''}
                          </div>
                        </div>
                    </div>
                </div>
            `).join('') || `<p class="text-muted" data-i18n="overview.no_instances"></p>`;
        }
    }

    function filterInstances() {
        const term = state.searchTerm.toLowerCase();
        state.filteredInstances = state.instances.filter(instance => {
            return instance.name.toLowerCase().includes(term) ||
                   instance.command.toLowerCase().includes(term) ||
                   (instance.type === 'docker' && instance.dockerConfig?.image.toLowerCase().includes(term));
        });
    }
    
    function renderInstancePage() {
        const instance = state.instances.find(i => i.id === state.activeInstanceId);
        if (!instance) return showOverview();

        // dom.instanceTitle.textContent = instance.name;
        
        const userPermission = state.currentUser.role === 'admin' ? 'full-control' : (instance.permissions?.[state.currentUser.id]?.terminal ?? null);
        const canOperate = state.currentUser.role === 'admin' || userPermission === 'read-write-ops' || userPermission === 'full-control';

        // Hide action buttons if the user doesn't have operational permissions and is not an admin
        if (!canOperate) {
            dom.instanceActionButtons.classList.add('d-none');
        } else {
            dom.instanceActionButtons.classList.remove('d-none');
            // Update button states
            const startBtn = dom.instanceActionButtons.querySelector('[data-action="start"]');
            const stopBtn = dom.instanceActionButtons.querySelector('[data-action="stop"]');
            const restartBtn = dom.instanceActionButtons.querySelector('[data-action="restart"]');

            if (instance.status === 'running') {
                startBtn.disabled = true;
                stopBtn.disabled = false;
                restartBtn.disabled = false;
            } else {
                startBtn.disabled = false;
                stopBtn.disabled = true;
                restartBtn.disabled = true;
            }
        }

        const settingsButtonContainer = dom.instanceActionButtons.querySelector('.btn-group button[data-action="edit-instance"]')?.parentNode;
        const canFullControl = state.currentUser.role === 'admin' || userPermission === 'full-control';

        if (settingsButtonContainer) {
            if (!canFullControl) {
                settingsButtonContainer.classList.add('d-none');
            } else {
                settingsButtonContainer.classList.remove('d-none');
            }
        }
    }


    // =================================================================
    // VIEW MANAGEMENT
    // =================================================================
    function hideAllPages() {
        dom.overviewPage.classList.add('d-none');
        dom.instancePage.classList.add('d-none');
        dom.usersPage.classList.add('d-none');
        document.getElementById('file-manager-page')?.classList.add('d-none'); // 隐藏文件管理页面
        // Hide all main titles
        dom.pageTitle.classList.add('d-none');
        dom.instancePageTitle.classList.add('d-none');
        // Remove active class from all sidebar links
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    }

    function showOverview() {
        destroyTerminal();
        state.activeInstanceId = null;
        state.activePage = 'overview';
        hideAllPages();
        dom.overviewPage.classList.remove('d-none');
        dom.pageTitle.classList.remove('d-none');
        dom.pageTitle.textContent = i18n.t('title.overview');
        document.getElementById('overview-link').classList.add('active');
        state.fullOverviewRenderNeeded = true;
        render();
        // Re-attach event listener for search input after rendering overview
        const searchInput = document.getElementById('instance-search-input');
        if (searchInput) {
            searchInput.removeEventListener('input', handleSearchInput);
            searchInput.addEventListener('input', handleSearchInput);
        }
    }

    // New handler for search input to prevent re-rendering the whole overview
    function handleSearchInput(e) {
        state.searchTerm = e.target.value;
        filterInstances();
        renderInstanceListOverview(); // Only re-render the instance list
    }

    function showInstance(instanceId) {
        const instance = state.instances.find(i => i.id === instanceId);
        if (!instance) {
            showToast(i18n.t('error.instance_not_found'), 'danger'); // Use new showToast
            return showOverview();
        }
        
        if (state.activeInstanceId !== instanceId) {
            destroyTerminal();
            state.activeInstanceId = instanceId;
        }
        state.activePage = 'instance';
        
        hideAllPages();
        dom.instancePage.classList.remove('d-none');
        dom.instancePageTitle.classList.remove('d-none');
        dom.instancePageTitle.textContent = instance.name;
        // Find the corresponding sidebar link and add active class
        const sidebarLink = document.querySelector(`.nav-link[data-id="${instanceId}"]`);
        if (sidebarLink) {
            sidebarLink.classList.add('active');
        }
        render();
        createTerminal(instance);
    }

    async function showUsersPage() {
        if (state.currentUser.role !== 'admin') {
            showToast(i18n.t('error.access_denied'), 'danger'); // Use new showToast
            return showOverview();
        }
        await fetchUsers(); // Fetch latest user list
        state.activeInstanceId = null;
        state.activePage = 'users';
        hideAllPages();
        dom.usersPage.classList.remove('d-none');
        dom.pageTitle.classList.remove('d-none');
        dom.pageTitle.textContent = i18n.t('title.users');
        document.getElementById('admin-users-link').classList.add('active');
        // Set search input value if returning to users page
        if (dom.userSearchInput) {
            dom.userSearchInput.value = state.searchTerm;
        }
        render();
    }

    // Update the page title display based on the active page
    function updatePageTitle() {
        // Ensure pageTitle is always visible for these pages, as it's the main heading
        dom.pageTitle.classList.remove('d-none');

        switch (state.activePage) {
            case 'overview':
                dom.pageTitle.textContent = i18n.t('title.overview');
                dom.instancePageTitle.classList.add('d-none'); // Hide instance specific title
                break;
            case 'instance':
                dom.instancePageTitle.textContent = state.instances.find(i => i.id === state.activeInstanceId)?.name || i18n.t('title.instances');
                dom.pageTitle.classList.add('d-none'); // Hide main page title
                dom.instancePageTitle.classList.remove('d-none'); // Ensure instance specific title is visible
                break;
            case 'users':
                dom.pageTitle.textContent = i18n.t('title.users');
                dom.instancePageTitle.classList.add('d-none'); // Hide instance specific title
                break;
            case 'file-manager':
                dom.pageTitle.textContent = i18n.t('title.files');
                dom.instancePageTitle.classList.add('d-none'); // Hide instance specific title
                break;
            default:
                // Fallback to overview if activePage is unknown
                dom.pageTitle.textContent = i18n.t('title.overview');
                dom.instancePageTitle.classList.add('d-none');
                break;
        }
    }
    
    // =================================================================
    // TERMINAL MANAGEMENT
    // =================================================================
    function createTerminal(instance) {
        if (state.activeTerminal) return; // Already created

        const userPermission = instance.permissions?.[state.currentUser.id]?.terminal;
        // For admin users, their permission is always considered full control for terminal access
        const effectiveUserPermission = state.currentUser.role === 'admin' ? 'full-control' : userPermission;
        const isReadOnly = effectiveUserPermission === 'read-only';
        const canOperate = effectiveUserPermission === 'read-write-ops' || effectiveUserPermission === 'full-control';

        // Check if the current user has permission to view this instance's terminal
        if (!effectiveUserPermission || effectiveUserPermission === 'remove') {
            dom.terminalContainer.innerHTML = `<div class="d-flex align-items-center justify-content-center h-100"><div class="text-center"><p class="fs-4 text-muted" data-i18n="instances.no_permission"></p></div></div>`;
            return;
        }

        if (instance.status !== 'running') {
            let startButton = '';
            if (canOperate || state.currentUser.role === 'admin') { // Admin can always operate
                startButton = `<button class="btn btn-success mt-3" data-action="start" data-id="${instance.id}">${i18n.t('instances.start')}</button>`;
            }
            dom.terminalContainer.innerHTML = `<div class="d-flex align-items-center justify-content-center h-100"><div class="text-center"><p class="fs-4 text-muted" data-i18n="instances.stopped.hint"></p>${startButton}</div></div>`;
            return;
        }

        dom.terminalContainer.innerHTML = '';
        const xterm = new Terminal({
            cursorBlink: true,
            theme: { background: '#000000' },
            scrollback: 5000,
            readOnly: isReadOnly // Set readOnly based on user permission
        });
        const fitAddon = new FitAddon.FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(dom.terminalContainer);
        
        state.activeTerminal = { xterm, fitAddon };
        
        sendSocketMessage({ type: 'subscribe', id: instance.id });

        fitAddon.fit();
        window.addEventListener('resize', () => fitAddon.fit());

        // Only allow writing to terminal if not read-only
        if (!isReadOnly) {
            xterm.onData(data => sendSocketMessage({ type: 'input', id: instance.id, data }));
        } else {
            xterm.write(`\x1b[33m${i18n.t('instances.termro.hint')}\x1b[0m\r\n`); // Yellow text for read-only message
        }
        xterm.onResize(({ cols, rows }) => sendSocketMessage({ type: 'resize', id: instance.id, cols, rows }));
    }

    function destroyTerminal() {
        if (state.activeInstanceId) sendSocketMessage({ type: 'unsubscribe', id: state.activeInstanceId });
        if (state.activeTerminal) {
            state.activeTerminal.xterm.dispose();
            state.activeTerminal = null;
        }
        dom.terminalContainer.innerHTML = '';
        updateInstanceStats({ cpu: '--', memory: '--' });
    }
    
    // =================================================================
    // NEW: PORT AND VOLUME EDITORS
    // =================================================================
    let currentPorts = [];
    let currentVolumes = [];
    let currentPortsDisplayElement;
    let currentPortsHiddenElement;
    let currentVolumesDisplayElement;
    let currentVolumesHiddenElement;
 
    function displayPorts(ports, displayElement, hiddenElement) {
        currentPorts = [];
        const portStrings = [];
        ports.forEach(p => {
            const parsed = parsePortString(p);
            if (parsed) { // Only add if parsing was successful
                currentPorts.push(parsed);
                // For display, combine tcp/udp back if they originated from tcp+udp
                if (parsed.protocol === 'tcp' && ports.some(otherP => parsePortString(otherP)?.protocol === 'udp' && parsePortString(otherP)?.hostPort === parsed.hostPort && parsePortString(otherP)?.containerPort === parsed.containerPort)) {
                    // Check if a UDP counterpart exists for the same host/container port
                    if (!portStrings.some(s => s.includes(`${parsed.hostPort}:${parsed.containerPort}/tcp+udp`))) {
                        portStrings.push(`${parsed.hostPort}:${parsed.containerPort}/tcp+udp`);
                    }
                } else if (parsed.protocol === 'udp' && ports.some(otherP => parsePortString(otherP)?.protocol === 'tcp' && parsePortString(otherP)?.hostPort === parsed.hostPort && parsePortString(otherP)?.containerPort === parsed.containerPort)) {
                    // Do nothing, it's handled by the TCP part
                } else {
                    portStrings.push(formatPortObject(parsed));
                }
            }
        });
        displayElement.textContent = portStrings.join(', ') || i18n.t('instances.docker.ports.not_configured');
        hiddenElement.value = JSON.stringify(currentPorts);
    }
 
    function displayVolumes(volumes, displayElement, hiddenElement) {
        currentVolumes = [];
        const volumeStrings = [];
        volumes.forEach(v => {
            const parsed = parseVolumeString(v);
            if (parsed) { // Only add if parsing was successful
                currentVolumes.push(parsed);
                volumeStrings.push(formatVolumeObject(parsed));
            }
        });
        displayElement.textContent = volumeStrings.join(', ') || i18n.t('instances.docker.volumes.not_configured');
        hiddenElement.value = JSON.stringify(currentVolumes);
    }
 
    function openPortForwardingModal(displayElement, hiddenElement) {
        currentPortsDisplayElement = displayElement;
        currentPortsHiddenElement = hiddenElement;
        
        // When opening the modal, we need to convert the stored simple format back to
        // what the modal expects, including re-merging tcp/udp if necessary for display.
        const parsedPortsForModal = [];
        const rawPorts = JSON.parse(hiddenElement.value || '[]');
        
        // Group TCP and UDP ports that share host and container ports
        const portMap = new Map(); // Key: `${hostPort}:${containerPort}`, Value: {tcpPort, udpPort}
        rawPorts.forEach(p => {
            const key = `${p.hostPort}:${p.containerPort}`;
            if (!portMap.has(key)) {
                portMap.set(key, {});
            }
            portMap.get(key)[p.protocol] = p;
        });
 
        portMap.forEach((protocols, key) => {
            if (protocols.tcp && protocols.udp) {
                // If both TCP and UDP exist for the same port, treat as tcp+udp for the modal
                parsedPortsForModal.push({
                    hostPort: protocols.tcp.hostPort,
                    containerPort: protocols.tcp.containerPort,
                    protocol: 'tcp+udp'
                });
            } else if (protocols.tcp) {
                parsedPortsForModal.push(protocols.tcp);
            } else if (protocols.udp) {
                parsedPortsForModal.push(protocols.udp);
            }
        });
 
        dom.portListEditor.innerHTML = '';
        if (parsedPortsForModal.length === 0) {
            addPortRow(); // Add an empty row if no ports exist
        } else {
            parsedPortsForModal.forEach(port => addPortRow(port));
        }
        state.modals.portForwarding.show();
    }
 
    function addPortRow(port = { hostPort: '', containerPort: '', protocol: 'tcp' }) {
        const row = document.createElement('div');
        row.classList.add('input-group', 'mb-2', 'port-row');
        row.innerHTML = `
            <input type="number" class="form-control host-port-input" value="${port.hostPort}">
            <span class="input-group-text">:</span>
            <input type="number" class="form-control container-port-input" value="${port.containerPort}">
            <select class="form-select protocol-select">
                <option value="tcp" ${port.protocol === 'tcp' ? 'selected' : ''}>TCP</option>
                <option value="udp" ${port.protocol === 'udp' ? 'selected' : ''}>UDP</option>
                <option value="tcp+udp" ${port.protocol === 'tcp+udp' ? 'selected' : ''}>TCP+UDP</option>
            </select>
            <button class="btn btn-outline-danger remove-port-row-btn" type="button">
                <i class="bi bi-trash"></i>
            </button>
        `;
        dom.portListEditor.appendChild(row);
 
        row.querySelector('.remove-port-row-btn').addEventListener('click', () => {
            row.remove();
            if (dom.portListEditor.children.length === 0) {
                addPortRow(); // Ensure there's always at least one row
            }
        });
    }
 
    function savePorts() {
        const ports = [];
        dom.portListEditor.querySelectorAll('.port-row').forEach(row => {
            const hostPort = row.querySelector('.host-port-input').value;
            const containerPort = row.querySelector('.container-port-input').value;
            const protocol = row.querySelector('.protocol-select').value;
 
            if (hostPort && containerPort) {
                if (protocol === 'tcp+udp') {
                    ports.push({ hostPort: parseInt(hostPort), containerPort: parseInt(containerPort), protocol: 'tcp' });
                    ports.push({ hostPort: parseInt(hostPort), containerPort: parseInt(containerPort), protocol: 'udp' });
                } else {
                    ports.push({ hostPort: parseInt(hostPort), containerPort: parseInt(containerPort), protocol });
                }
            }
        });
        currentPorts = ports; // Update the global currentPorts array
        displayPorts(ports.map(formatPortObject), currentPortsDisplayElement, currentPortsHiddenElement);
        state.modals.portForwarding.hide();
    }
 
    function openVolumeMountingModal(displayElement, hiddenElement) {
        currentVolumesDisplayElement = displayElement;
        currentVolumesHiddenElement = hiddenElement;
        currentVolumes = JSON.parse(hiddenElement.value || '[]');
        dom.volumeListEditor.innerHTML = '';
        if (currentVolumes.length === 0) {
            addVolumeRow(); // Add an empty row if no volumes exist
        } else {
            currentVolumes.forEach(volume => addVolumeRow(volume));
        }
        state.modals.volumeMounting.show();
    }
 
    function addVolumeRow(volume = { source: '', destination: '', readOnly: false }) {
        const row = document.createElement('div');
        row.classList.add('input-group', 'mb-2', 'volume-row');
        row.innerHTML = `
            <input type="text" class="form-control source-input" data-i18n="volume_mounting.host_directory_placeholder" value="${volume.source}">
            <span class="input-group-text">:</span>
            <input type="text" class="form-control destination-input" data-i18n="volume_mounting.container_directory_placeholder" value="${volume.destination}">
            <div class="input-group-text">
                <div class="form-check form-switch m-0">
                    <input class="form-check-input read-only-switch" type="checkbox" ${volume.readOnly ? 'checked' : ''}>
                    <label class="form-check-label" data-i18n="volume_mounting.read_only_label"></label>
                </div>
            </div>
            <button class="btn btn-outline-danger remove-volume-row-btn" type="button">
                <i class="bi bi-trash"></i>
            </button>
        `;
        dom.volumeListEditor.appendChild(row);
 
        row.querySelector('.remove-volume-row-btn').addEventListener('click', () => {
            row.remove();
            if (dom.volumeListEditor.children.length === 0) {
                addVolumeRow(); // Ensure there's always at least one row
            }
        });
    }
 
    function saveVolumes() {
        const volumes = [];
        dom.volumeListEditor.querySelectorAll('.volume-row').forEach(row => {
            const source = row.querySelector('.source-input').value;
            const destination = row.querySelector('.destination-input').value;
            const readOnly = row.querySelector('.read-only-switch').checked;
 
            if (source && destination) {
                volumes.push({ source, destination, readOnly });
            }
        });
        currentVolumes = volumes; // Update the global currentVolumes array
        displayVolumes(volumes.map(formatVolumeObject), currentVolumesDisplayElement, currentVolumesHiddenElement);
        state.modals.volumeMounting.hide();
    }
 
    // =================================================================
    // UI UPDATES & MODAL HANDLING
    // =================================================================
    function updateSystemStats({ cpu, mem, totalMem }) {
        const cpuStat = dom.overviewPage.querySelector('#cpu-stat'); // Ensure we target the correct element on the overview page
        const memStat = dom.overviewPage.querySelector('#mem-stat'); // Ensure we target the correct element on the overview page
        if (cpuStat) cpuStat.textContent = `${cpu}%`;
        if (memStat) memStat.textContent = `${mem}/${totalMem} GB`;
    }
 
    function updateInstanceStats({ cpu, memory }) {
        // Ensure we update the badge only if the current instance page is active
        if (state.activeInstanceId) {
            dom.instanceStatsBadge.textContent = `CPU: ${cpu}% | Mem: ${memory} MB`;
        }
    }
    
    function openSettingsModal(instanceId) {
        const instance = state.instances.find(i => i.id === instanceId);
        if (!instance) return showToast(i18n.t('error.instance_not_found'), 'danger');
 
        document.getElementById('settings-instance-id').value = instance.id;
        document.getElementById('settings-instance-name').value = instance.name;
        dom.settingsInstanceCommand.value = instance.command;
        document.getElementById('settings-instance-cwd').value = instance.cwd || '';
        document.getElementById('settings-autostart').checked = instance.autoStartOnBoot;
        dom.settingsAutoRestart.checked = instance.autoRestart; // Set autoRestart checkbox state
        document.getElementById('settings-autodelete').checked = instance.autoDeleteOnExit;
        dom.settingsInstanceEnv.value = formatEnvObject(instance.env || {});
        
        // Handle command input visibility and required status for settings modal
        if (instance.type === 'docker') {
            dom.settingsInstanceCommand.classList.add('d-none');
            dom.settingsInstanceCommandLabel.classList.add('d-none');
            dom.settingsInstanceCommand.required = false;
        } else {
            dom.settingsInstanceCommand.classList.remove('d-none');
            dom.settingsInstanceCommandLabel.classList.remove('d-none');
            dom.settingsInstanceCommand.required = true;
        }
 
        // Handle Docker settings visibility and values
        if (instance.type === 'docker') {
            dom.dockerSettingsSettings.classList.remove('d-none');
            dom.settingsDockerImage.value = instance.dockerConfig?.image || '';
            dom.settingsDockerContainerName.value = instance.dockerConfig?.containerName || '';
            // New: Display formatted ports and volumes
            displayPorts(instance.dockerConfig?.ports || [], dom.settingsDockerPortsDisplay, dom.settingsDockerPortsHidden);
            displayVolumes(instance.dockerConfig?.volumes || [], dom.settingsDockerVolumesDisplay, dom.settingsDockerVolumesHidden);
            dom.settingsDockerWorkingDir.value = instance.dockerConfig?.workingDir || '';
            dom.settingsDockerCommand.value = instance.dockerConfig?.command || '';
        } else {
            dom.dockerSettingsSettings.classList.add('d-none');
        }
 
        const dangerZone = dom.settingsInstanceForm.querySelector('div.mt-3 h5.text-danger')?.parentNode;
        if (dangerZone) {
            if (state.currentUser.role !== 'admin') { // Only admins can see the danger zone
                dangerZone.classList.add('d-none');
            } else {
                dangerZone.classList.remove('d-none');
            }
        }
 
        state.modals.settings.show();
    }


    // =================================================================
    // EVENT LISTENERS
    // =================================================================
    function bindEventListeners() {
        dom.sidebarToggleBtn.addEventListener('click', () => {
            dom.sidebar.classList.toggle('collapsed');
            // If file manager is active, re-render to adjust modification time column
            if (state.activePage === 'file-manager' && typeof window.showFileManager === 'function') {
                window.showFileManager();
            }
        });
        dom.sidebarCloseBtn.addEventListener('click', () => {
            dom.sidebar.classList.remove('collapsed');
            // If file manager is active, re-render to adjust modification time column
            if (state.activePage === 'file-manager' && typeof window.showFileManager === 'function') {
                window.showFileManager();
            }
        });

        document.getElementById('overview-link').addEventListener('click', (e) => { e.preventDefault(); showOverview(); });
        // New: User management link click
        dom.adminUsersLink.addEventListener('click', (e) => { e.preventDefault(); showUsersPage(); });
        // New: File manager link click
        dom.fileManagerLink.addEventListener('click', (e) => {
            e.preventDefault();
            state.activePage = 'file-manager';
            hideAllPages();
            dom.pageTitle.classList.remove('d-none');
            dom.pageTitle.textContent = i18n.t('title.files');
            if (typeof window.showFileManager === 'function') {
                window.showFileManager();
            } else {
                showToast(i18n.t('files.not_loaded'), 'danger'); // Use new showToast
            }
            dom.fileManagerLink.classList.add('active');
        });

        dom.logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault(); // Prevent default link behavior
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login.html';
        });

        dom.changePasswordDropdownItem.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default link behavior
            openChangePasswordModal(state.currentUser.id); // Open change password modal for the current user
        });
        
        // Handle instance type selection visibility for create modal
        dom.createInstanceType.addEventListener('change', (e) => {
            const isDocker = e.target.value === 'docker';
            if (isDocker) {
                dom.dockerSettingsCreate.classList.remove('d-none');
                dom.createInstanceCommand.classList.add('d-none');
                dom.createInstanceCommandLabel.classList.add('d-none');
                dom.createInstanceCommand.required = false;
            } else {
                dom.dockerSettingsCreate.classList.add('d-none');
                dom.createInstanceCommand.classList.remove('d-none');
                dom.createInstanceCommandLabel.classList.remove('d-none');
                dom.createInstanceCommand.required = true;
            }
        });
        // Initial call to set visibility based on default selected value
        dom.createInstanceType.dispatchEvent(new Event('change'));
        
        document.body.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action], [data-bs-toggle="dropdown"], [data-bs-target]');
            if (!target) return;
 
            // Prevent dropdown toggle or modal trigger from triggering action
            if (target.matches('[data-bs-toggle="dropdown"]') || target.matches('[data-bs-target]')) {
                return;
            }
 
            e.preventDefault();
            const action = target.dataset.action;
            const id = target.dataset.id || state.activeInstanceId; // 从 data-id 获取实例ID，如果不存在则使用 activeInstanceId
            // 如果 action 是 edit-instance，则确保 activeInstanceId 被正确设置
            if (action === 'edit-instance' && id) {
                state.activeInstanceId = id;
            }
            const instance = state.instances.find(i => i.id === id);

            let actualAction = action;
            if (instance && instance.type === 'docker' && action === 'stop') {
                actualAction = 'interrupt'; // For Docker, 'stop' button sends interrupt
            }
 
            switch(actualAction) {
                case 'show-instance': showInstance(id); if (window.innerWidth < 768) dom.sidebar.classList.add('collapsed'); break;
                case 'stop': case 'start': case 'interrupt': case 'terminate': case 'restart': case 'force-restart': performInstanceAction(id, actualAction); break;
                case 'edit-instance': openSettingsModal(id); break;
                case 'remove-instance-only':
                    displayConfirmDeleteModal(id, false);
                    break;
                case 'delete-instance-with-data':
                    displayConfirmDeleteModal(id, true);
                    break;
                // User management actions
                case 'edit-user-permissions': openUserPermissionsModal(id); break;
                case 'delete-user': displayConfirmDeleteUserModal(id); break;
                case 'change-user-password': openChangePasswordModal(id); break; // Open change password modal
                case 'edit-username': openEditUsernameModal(id, target.dataset.username); break; // Open edit username modal
            }
        });

        // New: Edit username form submission
        if (dom.editUsernameForm) {
            dom.editUsernameForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const userId = dom.editUsernameUserId.value;
                const newUsername = dom.editUsernameInput.value;

                try {
                    const response = await fetch(`/api/users/${userId}/username`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: newUsername }),
                    });
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.message || i18n.t('error.update_username_failed'));
                    }
                    showToast(i18n.t('success.username_update'), 'success'); // Use new showToast
                    state.modals.editUsername.hide(); // Hide the modal
                    dom.editUsernameForm.reset(); // Clear the form
                    await fetchUsers(); // Refresh user list
                    renderUsersPage(); // Re-render users table
                    // If the current user's username was changed, update the display
                    if (state.currentUser.id === userId) {
                        state.currentUser.username = newUsername;
                        dom.usernameDisplay.textContent = newUsername;
                        dom.userDropdownMenuButton.textContent = i18n.t('panel.greeting', { username: newUsername });
                    }
                } catch (error) {
                    showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
                }
            });
        }

        // New: Event listener for user search input
        if (dom.userSearchInput) {
           dom.userSearchInput.addEventListener('input', (e) => {
               state.searchTerm = e.target.value;
               renderUsersPage(); // Re-render users based on search term
           });
        }

        dom.createUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userData = {
                username: dom.createUsername.value,
                password: dom.createPassword.value,
                role: dom.createUserRole.value,
            };
            await createUser(userData);
        });

        dom.confirmDeleteUserBtn.addEventListener('click', async () => {
            const userId = dom.confirmDeleteUserBtn.dataset.userId;
            if (userId) {
                await deleteUser(userId);
            }
        });

        // New: Change password form submission (moved to separate modal)
        const changePasswordForm = document.getElementById('change-password-form');
       if (changePasswordForm) {
           changePasswordForm.addEventListener('submit', async (e) => {
               e.preventDefault();
               const userId = dom.changePasswordUserId.value; // Get userId from the hidden input
               const oldPassword = dom.oldPasswordInput.value; // Get old password from input
               const newPassword = document.getElementById('new-password').value;
               const confirmNewPassword = document.getElementById('confirm-new-password').value;

               if (newPassword !== confirmNewPassword) {
                   showToast(i18n.t('error.password_mismatch'), 'danger'); // Use new showToast
                   return;
               }
               
               if (!userId) {
                   showToast(i18n.t('error.userid_empty'), 'danger'); // Use new showToast
                   return;
               }

               try {
                   const response = await fetch(`/api/users/${userId}/password`, {
                       method: 'PUT',
                       headers: { 'Content-Type': 'application/json' },
                       body: JSON.stringify({ oldPassword, newPassword }), // Send old and new password
                   });
                   if (!response.ok) {
                       const errorData = await response.json();
                       throw new Error(errorData.message || i18n.t('error.change_password_failed'));
                   }
                   showToast(i18n.t('success.password_update'), 'success'); // Use new showToast
                   state.modals.changePassword.hide(); // Hide the correct modal after successful password change
                   changePasswordForm.reset(); // Clear the form
               } catch (error) {
                   showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
               }
           });
       }

        // Event listener for permission changes within the user permissions modal
        dom.instancePermissionsList.addEventListener('change', async (e) => {
            const instanceId = e.target.dataset.instanceId;
            const userId = dom.editPermissionsUserId.value;
            const instancePermissions = state.instances.find(i => i.id === instanceId)?.permissions?.[userId] || { terminal: null, fileManagement: false };
            
            let updatedTerminalPermission = instancePermissions.terminal;
            let updatedFileManagement = instancePermissions.fileManagement;

            if (e.target.matches('.permission-select')) {
                updatedTerminalPermission = e.target.value === 'remove' ? null : e.target.value;
            } else if (e.target.matches('.file-management-checkbox')) {
                updatedFileManagement = e.target.checked;
            }
            await updateUserPermission(instanceId, userId, updatedTerminalPermission, updatedFileManagement);
            await openUserPermissionsModal(userId); // Re-open to refresh the state
        });
        
        // Handle confirmation of delete action
        dom.confirmDeleteBtn.addEventListener('click', () => {
            const id = dom.confirmDeleteBtn.dataset.instanceId;
            const deleteData = dom.confirmDeleteBtn.dataset.deleteData === 'true';
            if (id) {
                deleteInstance(id, deleteData);
            }
        });
 
        // Form Submissions
        dom.createInstanceForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const type = dom.createInstanceType.value;
            const data = {
                name: document.getElementById('create-instance-name').value,
                command: document.getElementById('create-instance-command').value,
                cwd: document.getElementById('create-instance-cwd').value,
                type: type,
                autoStartOnBoot: document.getElementById('create-autostart').checked,
                autoDeleteOnExit: document.getElementById('create-autodelete').checked,
                env: parseEnvString(dom.createInstanceEnv.value),
            };
 
            if (type === 'docker') {
                data.dockerConfig = {
                    image: dom.createDockerImage.value,
                    containerName: dom.createDockerContainerName.value,
                    // New: Use currentPorts directly
                    ports: currentPorts.map(formatPortObject),
                    // New: Use currentVolumes directly
                    volumes: currentVolumes.map(formatVolumeObject),
                    workingDir: dom.createDockerWorkingDir.value,
                    command: dom.createDockerCommand.value,
                };
            }

            if (!data.command && type !== 'docker') return showToast(i18n.t('error.command_required'), 'danger'); // Use new showToast
            // 如果是 Docker 实例，command 可以为空，但 Docker Image 必须有
            if (type === 'docker' && !data.dockerConfig?.image) return showToast(i18n.t('error.image_required'), 'danger'); // Use new showToast
 
            createInstance(data);
        });

        dom.settingsInstanceForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('settings-instance-id').value;
            const instance = state.instances.find(i => i.id === id); // Get current instance to know its type
            const data = {
                name: document.getElementById('settings-instance-name').value,
                command: document.getElementById('settings-instance-command').value,
                cwd: document.getElementById('settings-instance-cwd').value,
                autoStartOnBoot: document.getElementById('settings-autostart').checked,
                autoRestart: dom.settingsAutoRestart.checked, // Include autoRestart in the data
                autoDeleteOnExit: document.getElementById('settings-autodelete').checked,
                env: parseEnvString(dom.settingsInstanceEnv.value),
            };

            if (instance && instance.type === 'docker') {
                data.dockerConfig = {
                    image: dom.settingsDockerImage.value,
                    containerName: dom.settingsDockerContainerName.value,
                    // New: Use currentPorts directly
                    ports: currentPorts.map(formatPortObject),
                    // New: Use currentVolumes directly
                    volumes: currentVolumes.map(formatVolumeObject),
                    workingDir: dom.settingsDockerWorkingDir.value,
                    command: dom.settingsDockerCommand.value,
                };
            }
 
            if (!data.command && instance?.type !== 'docker') return showToast(i18n.t('error.command_required'), 'danger'); // Use new showToast
            // 如果是 Docker 实例，command 可以为空，但 Docker Image 必须有
            if (instance?.type === 'docker' && !data.dockerConfig?.image) return showToast(i18n.t('error.image_required'), 'danger'); // Use new showToast
 
            updateInstance(id, data);
        });

        // New: Port Forwarding Modal buttons
        dom.addPortRowBtn.addEventListener('click', () => addPortRow());
        dom.savePortsBtn.addEventListener('click', () => savePorts());

        // New: Volume Mounting Modal buttons
        dom.addVolumeRowBtn.addEventListener('click', () => addVolumeRow());
        dom.saveVolumesBtn.addEventListener('click', () => saveVolumes());

        // Bind buttons to open new modals for create instance form
        dom.editPortsBtn.addEventListener('click', () => openPortForwardingModal(dom.createDockerPortsDisplay, dom.createDockerPortsHidden));
        dom.editVolumesBtn.addEventListener('click', () => openVolumeMountingModal(dom.createDockerVolumesDisplay, dom.createDockerVolumesHidden));

        // Bind buttons to open new modals for settings instance form
        dom.editSettingsPortsBtn.addEventListener('click', () => openPortForwardingModal(dom.settingsDockerPortsDisplay, dom.settingsDockerPortsHidden));
        dom.editSettingsVolumesBtn.addEventListener('click', () => openVolumeMountingModal(dom.settingsDockerVolumesDisplay, dom.settingsDockerVolumesHidden));
    }
    
    function displayConfirmDeleteModal(instanceId, deleteData) {
        const instance = state.instances.find(i => i.id === instanceId);
        if (!instance) return showToast(i18n.t('error.instance_not_found'), 'danger'); // Use new showToast
 
        if (state.currentUser.role !== 'admin') { // Only admins can delete instances
            showToast(i18n.t('error.no_perms_delete'), 'danger'); // Use new showToast
            return;
        }

        const deleteItemNameSpan = dom.confirmDeleteModal.querySelector('#delete-item-name');
        const confirmDeleteMessage = dom.confirmDeleteModal.querySelector('#confirm-delete-message');
        const deleteFileListContainer = dom.confirmDeleteModal.querySelector('#delete-file-list-container');
        const deleteItemNameParagraph = deleteItemNameSpan ? deleteItemNameSpan.closest('p') : null;

        // 重置显示状态，确保文件列表容器隐藏，单个项目名称显示
        if (deleteItemNameParagraph) deleteItemNameParagraph.classList.remove('d-none');
        if (confirmDeleteMessage) confirmDeleteMessage.classList.remove('d-none');
        if (deleteFileListContainer) deleteFileListContainer.classList.add('d-none');

        if (deleteItemNameSpan) {
            deleteItemNameSpan.textContent = instance.name;
        }

        if (deleteData) {
            confirmDeleteMessage.textContent = i18n.t('instances.danger.delete.confirm', { type: instance.type === 'docker' ? 'Docker' : '' });
        } else {
            confirmDeleteMessage.textContent = i18n.t('instances.danger.delete.remove_only.confirm', { type: instance.type === 'docker' ? 'Docker' : '' });
        }
        
        dom.confirmDeleteBtn.dataset.instanceId = instanceId;
        dom.confirmDeleteBtn.dataset.deleteData = deleteData;
        if (deleteData) {
            dom.confirmDeleteBtn.textContent = i18n.t('instances.danger.delete');
            dom.confirmDeleteBtn.classList.remove('btn-danger');
            dom.confirmDeleteBtn.classList.add('btn-warning');
        } else {
            dom.confirmDeleteBtn.textContent = i18n.t('instances.danger.remove_only');
            dom.confirmDeleteBtn.classList.remove('btn-warning');
            dom.confirmDeleteBtn.classList.add('btn-danger');
        }
        state.modals.confirmDelete.show();
    }

    // =================================================================
    // =================================================================
    // USER MANAGEMENT UI RENDERING
    // =================================================================
    function renderUsersPage() {
       const term = state.searchTerm.toLowerCase();
       const filteredUsers = state.users.filter(user => {
           return user.username.toLowerCase().includes(term);
       });

        dom.userTableBody.innerHTML = '';
        filteredUsers.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    ${user.username}
                    <button class="btn btn-sm btn-outline-secondary ms-2" data-action="edit-username" data-id="${user.id}" data-username="${user.username}">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                </td>
                <td><span data-i18n="${user.role === 'admin' ? 'users.role.admin' : 'users.role.user'}"></span></td>
                <td class="text-end"> <!-- Align buttons to the right -->
                    <button class="btn btn-sm btn-warning me-2" data-action="change-user-password" data-id="${user.id}" ${user.role === 'admin' ? 'disabled' : ''}>
                        <i class="bi bi-key me-1"></i> <span data-i18n="users.change_password"></span>
                    </button>
                    <button class="btn btn-sm btn-info me-2" data-action="edit-user-permissions" data-id="${user.id}">
                        <i class="bi bi-shield-lock me-1"></i> <span data-i18n="users.edit_permissions"></span>
                    </button>
                    <button class="btn btn-sm btn-danger" data-action="delete-user" data-id="${user.id}" ${state.currentUser.id === user.id ? 'disabled' : ''}>
                        <i class="bi bi-trash me-1"></i> <span data-i18n="users.delete"></span>
                    </button>
                </td>
            `;
            dom.userTableBody.appendChild(row);
        });
    }

    async function updateUserRole(userId, newRole) {
        try {
            const response = await fetch(`/api/users/${userId}/role`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || i18n.t('error.update_user_role_failed'));
            }
            showToast(i18n.t('success.role_update'), 'success'); // Use new showToast
            await fetchUsers(); // Refresh user list
            renderUsersPage(); // Re-render users table
        } catch (error) {
            showToast(i18n.t(error.message), 'danger'); // Use new showToast for errors
        }
    }

    async function openUserPermissionsModal(userId) {
        const user = state.users.find(u => u.id === userId);
        if (!user) return showToast(i18n.t('error.user_not_found'), 'danger'); // Use new showToast

        // Set initial role value and disable if current user is not admin
        dom.editPermissionsRole.value = user.role;
        // 如果当前用户不是管理员，或者正在编辑自己的管理员账户，则禁用角色修改
        if (state.currentUser.role !== 'admin' || (state.currentUser.id === user.id && user.role === 'admin')) {
            dom.editPermissionsRole.disabled = true;
        } else {
            dom.editPermissionsRole.disabled = false;
        }

        dom.editPermissionsUsername.textContent = user.username;
        dom.editPermissionsUserId.value = user.id;
        dom.instancePermissionsList.innerHTML = '';

        // Hide instance permissions for admins
        if (user.role === 'admin') {
            dom.instancePermissionsContainer.classList.add('d-none');
            dom.instancePermissionsList.innerHTML = '';
            state.modals.editUserPermissions.show();
            return;
        } else {
            dom.instancePermissionsContainer.classList.remove('d-none');
        }
        
        dom.instancePermissionsList.innerHTML = ''; // Clear previous entries

        state.instances.forEach(instance => {
            const userInstancePermissions = instance.permissions?.[userId] || { terminal: null, fileManagement: false };
            const currentTerminalPermission = userInstancePermissions.terminal || 'remove';
            const currentFileManagement = userInstancePermissions.fileManagement === true;

            const permissionOptions = `
                <option value="remove" ${currentTerminalPermission === 'remove' ? 'selected' : ''}>${i18n.t('users.perms.none')}</option>
                <option value="read-only" ${currentTerminalPermission === 'read-only' ? 'selected' : ''}>${i18n.t('users.perms.termro')}</option>
                <option value="read-write" ${currentTerminalPermission === 'read-write' ? 'selected' : ''}>${i18n.t('users.perms.termrw')}</option>
                <option value="read-write-ops" ${currentTerminalPermission === 'read-write-ops' ? 'selected' : ''}>${i18n.t('users.perms.termrw.ops')}</option>
                <option value="full-control" ${currentTerminalPermission === 'full-control' ? 'selected' : ''}>${i18n.t('users.perms.fullcontrol')}</option>
            `;
            const listItem = document.createElement('div');
            listItem.classList.add('list-group-item', 'd-flex', 'justify-content-between', 'align-items-center', 'flex-wrap', 'py-3');
            listItem.innerHTML = `
                <div class="d-flex align-items-center me-3 mb-2 mb-md-0">
                    <i class="bi ${instance.type === 'docker' ? 'bi-box-seam' : 'bi-terminal'} me-2"></i> <strong>${instance.name}</strong>
                </div>
                <div class="d-flex align-items-center flex-grow-1 justify-content-end">
                    <div class="form-check form-switch me-3">
                        <input class="form-check-input file-management-checkbox" type="checkbox" role="switch" id="file-management-${instance.id}-${userId}" data-instance-id="${instance.id}" ${currentFileManagement ? 'checked' : ''}>
                        <label class="form-check-label" for="file-management-${instance.id}-${userId}" data-i18n="users.perms.files"></label>
                    </div>
                    <select class="form-select w-auto permission-select" data-instance-id="${instance.id}">
                        ${permissionOptions}
                    </select>
                </div>
            `;
            dom.instancePermissionsList.appendChild(listItem);
        });

        state.modals.editUserPermissions.show();
    }

    // Add event listener for role selection change
    dom.editPermissionsRole.addEventListener('change', async (e) => {
        const userId = dom.editPermissionsUserId.value;
        const newRole = e.target.value;
        await updateUserRole(userId, newRole); // This will also re-render the user table and update current user's role in state if needed

        // Dynamically show/hide instance permissions container
        if (newRole === 'admin') {
            dom.instancePermissionsContainer.classList.add('d-none');
        } else {
            dom.instancePermissionsContainer.classList.remove('d-none');
        }
    });

    function displayConfirmDeleteUserModal(userId) {
        const user = state.users.find(u => u.id === userId);
        if (!user) return showToast(i18n.t('error.user_not_found'), 'danger'); // Use new showToast
 
        dom.confirmDeleteUserName.textContent = user.username;
        dom.confirmDeleteUserBtn.dataset.userId = userId;
        state.modals.confirmDeleteUser.show();
    }
    async function openChangePasswordModal(userId) {
        let user = null;
        if (userId === state.currentUser.id) { // If changing current user's password
            user = state.currentUser;
        } else { // If an admin is changing another user's password from the user management page
            user = state.users.find(u => u.id === userId);
        }
 
        if (!user) {
            return showToast(i18n.t('error.user_not_found'), 'danger'); // Use new showToast
        }

        dom.changePasswordUsernameDisplay.textContent = user.username;
        dom.changePasswordUserId.value = user.id; // 设置隐藏的用户 ID
        dom.oldPasswordInput.value = ''; // 清空旧密码输入
        document.getElementById('new-password').value = ''; // 清空新密码输入
        document.getElementById('confirm-new-password').value = ''; // 清空确认新密码输入
        
        // 管理员修改其他用户密码时隐藏旧密码输入框
        if (state.currentUser.role === 'admin' && state.currentUser.id !== userId) {
            dom.oldPasswordInput.closest('.mb-3').classList.add('d-none');
            dom.oldPasswordInput.removeAttribute('required'); // 移除必填属性
        } else {
            dom.oldPasswordInput.closest('.mb-3').classList.remove('d-none');
            dom.oldPasswordInput.setAttribute('required', 'true'); // 添加必填属性
        }

        state.modals.changePassword.show();
    }

    // Open Edit Username Modal
    async function openEditUsernameModal(userId, username) {
        const user = state.users.find(u => u.id === userId);
        if (!user) return showToast(i18n.t('error.user_not_found'), 'danger'); // Use new showToast
 
        dom.editUsernameDisplay.textContent = user.username;
        dom.editUsernameUserId.value = user.id;
        dom.editUsernameInput.value = user.username; // Pre-fill with current username
        state.modals.editUsername.show();
    }

    // Expose a function to allow other modules to register WebSocket message handlers
    window.registerWebSocketHandler = (name, handler) => {
        if (typeof handler === 'function') {
            state.websocketMessageHandlers.set(name, handler);
            console.log(`WebSocket handler '${name}' registered.`);
        } else {
            console.error(`Attempted to register non-function as WebSocket handler for '${name}'.`);
        }
    };

    // Expose a function to allow other modules to unregister WebSocket message handlers
    window.unregisterWebSocketHandler = (name) => {
        if (state.websocketMessageHandlers.has(name)) {
            state.websocketMessageHandlers.delete(name);
            console.log(`WebSocket handler '${name}' unregistered.`);
        }
    };
 
    init();
});