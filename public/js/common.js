/**
 * common.js
 * Contains shared utility functions for the frontend application.
 */

/**
     * Displays a Bootstrap toast notification.
     * @param {string} message The message to display.
     * @param {'primary'|'secondary'|'success'|'danger'|'warning'|'info'|'light'|'dark'} type The toast type (color).
     * @param {string|null} id Optional unique ID for the toast, allows updating existing toasts.
     * @param {boolean} persistent If true, the toast will not auto-hide.
     * @param {number|null} progress Optional progress percentage (0-100) for a progress bar.
     */
function showToast(message, type = 'info', id = null, persistent = false, progress = null) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        console.error('Toast container not found!');
        return;
    }
    console.log('toast type:', type, 'msg:', message, 'id:', id, persistent, progress);
    let toastElement;
    let bsToast;

    if (id && window.globalState.activeToasts.has(id)) {
        // Update existing toast
        toastElement = window.globalState.activeToasts.get(id);
        toastElement.querySelector('.toast-body').textContent = message;
        toastElement.querySelector('.toast-body').innerHTML += `
                    <div class="progress mt-2" style="height: 5px;">
                        <div class="progress-bar bg-white" role="progressbar" style="width: ${progress}%;" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">${progress}%</div>
                    </div>
                `;
        // Update toast type if it changes (e.g., from info to success/danger)
        const header = toastElement.querySelector('.toast-header');
        if (header) {
            // Remove existing bg- and text- classes
            header.className = header.className.split(' ').filter(c => !c.startsWith('bg-') && !c.startsWith('text-')).join(' ');
            header.classList.add(`bg-${type}`, `text-white`);
        }

        // If progress is 100 or 0 (failed), and it was persistent, auto-hide after a delay
        if (progress === 100 && persistent) {
            bsToast = bootstrap.Toast.getInstance(toastElement);
            if (bsToast) {
                setTimeout(() => {
                    bsToast.hide();
                    window.globalState.activeToasts.delete(id); // Remove from active toasts after hiding
                }, 5000); // Hide after 5 seconds
            }
        }

    } else {
        // Create new toast
        toastElement = document.createElement('div');
        toastElement.classList.add('toast', 'align-items-center', `bg-${type}`, 'border-0');
        toastElement.setAttribute('role', 'alert');
        toastElement.setAttribute('aria-live', persistent ? 'assertive' : 'polite');
        toastElement.setAttribute('aria-atomic', 'true');
        if (!persistent) {
            toastElement.setAttribute('data-bs-delay', '5000'); // Auto-hide after 5 seconds
        } else {
            toastElement.setAttribute('data-bs-delay', '9999999999');
        }
        message = i18n.t(message);
        let progressBarHtml = '';
        if (progress !== null) {
            progressBarHtml = `
                    <div class="progress mt-2" style="height: 5px;">
                        <div class="progress-bar bg-white" role="progressbar" style="width: ${progress}%;" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">${progress}%</div>
                    </div>
                `;
        }

        toastElement.innerHTML = `
                <div class="d-flex">
                    <div class="toast-body" style="width:100%">
                        ${message}
                        ${progressBarHtml}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            `;
        toastContainer.appendChild(toastElement);

        bsToast = new bootstrap.Toast(toastElement);
        bsToast.show();

        if (id) {
            window.globalState.activeToasts.set(id, toastElement);
            // Remove from active toasts when hidden
            toastElement.addEventListener('hidden.bs.toast', () => {
                window.globalState.activeToasts.delete(id);
                toastElement.remove();
            });
        } else {
            // For non-persistent toasts without an ID, just remove them when hidden
            toastElement.addEventListener('hidden.bs.toast', () => {
                toastElement.remove();
            });
        }
    }
}