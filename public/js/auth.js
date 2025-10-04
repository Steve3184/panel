document.addEventListener('DOMContentLoaded', () => {
    const setupForm = document.getElementById('setup-form');
    const loginForm = document.getElementById('login-form');
    const errorMessageDiv = document.getElementById('error-message');

    const displayError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.classList.remove('d-none');
    };

    if (setupForm) {
        setupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/api/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'An error occurred.');
                }
                alert('Admin account created!');
                window.location.href = '/login.html';
            } catch (error) {
                displayError(error.message);
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'Login failed.');
                }
                window.location.href = '/';
            } catch (error) {
                displayError(error.message);
            }
        });
    }
});