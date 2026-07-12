# The Panel

<div align="center">

![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange?style=flat-square)

**English** | [简体中文](README_CN.md)

**A powerful, user-friendly, web-based server management panel.**

*Streamline the administration of instances, files, and users with a modern interface. Whether you are managing raw Shell commands or Docker containers, Panel provides seamless control.*

[Features](#-features) • [Quick Start](#-quick-start) • [Configuration](#-configuration) • [Screenshots](#-screenshots)

</div>

---

## ✨ Features

### 🖥️ Instance Management
Take full control of your services with support for both **Shell** and **Docker** environments.
-   **Lifecycle Control**: Create, start, stop, restart, and terminate instances with one click.
-   **Docker Mastery**: Configure images, ports, volumes, working directories, and custom commands effortlessly.
-   **Automation**: Set auto-start on boot, auto-restart on failure, and auto-delete on exit.
-   **Monitoring**: Real-time CPU and Memory usage tracking.
-   **Web Terminal**: Full interactive terminal access for every instance.
-   <details><summary>📷 <i>View Screenshots</i></summary><br><img src="images/5.webp" alt="Instance Overview"><br><img src="images/12.webp" alt="Instance Terminal"><br><img src="images/2.webp" alt="Instance Settings"></details>

### 👥 User & Permission RBAC
Secure and flexible user management designed for teams.
-   **Roles**: Distinct `admin` and `user` roles.
-   **Granular Control**: Define permissions per instance:
    -   *Terminal*: No Access, Read-only, Read/Write, or Full Control.
    -   *Files*: Toggle file management access.
-   **Security**: Secure password updates and account management.
-   <details><summary>📷 <i>View Screenshots</i></summary><br><img src="images/11.webp" alt="User Management"><br><img src="images/10.webp" alt="Instance Permissions"></details>

### 📂 Advanced File Management
A desktop-class file manager directly in your browser.
-   **Operations**: Navigate, create, rename, copy, move (cut-paste), and delete.
-   **Transfer**: Chunked uploads for large files and easy downloads.
-   **Code Editor**: Monaco Editor integration (VS Code style) with syntax highlighting and real-time websocket sync.
-   **Archives**: Compress (zip, 7z, tar.gz, etc.) and Extract (zip, tar, bz2, etc.) directly on the server.
-   **Safety**: Blacklist protection for binary/system files.
-   <details><summary>📷 <i>View Screenshots</i></summary><br><img src="images/9.webp" alt="File Browser"><br><img src="images/8.webp" alt="Online File Editor"></details>

### 🔗 Connectivity & Access
-   **WebDAV Support**: Mount your instance files locally via WebDAV (`/api/dav/<instance-id>/`).
-   **Gradio Tunnel**: Built-in remote access (no FRP/port forwarding required).
-   **Internationalization**: Full i18n support (EN, CN, JP, etc.).
-   **Responsive Design**: Works perfectly on mobile, tablet, and desktop.

---

## 🚀 Quick Start

### Prerequisites
*   **Unzip**: For extracting releases
*   **Docker**: (Optional) For container management
*   **7-Zip**: (Optional) For advanced archiving features
*   **Bubblewrap**: Included in Linux release archives; install it separately when running from source

**Note**: Node.js is **NOT** required when using pre-built releases, as they include all dependencies.

### Installation

#### Option 1: Install from Release (Recommended) ⚡
*Fastest deployment. No build tools required.*

**For Linux x64:**
```bash
# 1. Install unzip and wget
sudo apt install -y unzip wget

# 2. Download and extract
sudo mkdir -p /opt/panel && cd /opt/panel
sudo wget https://github.com/Steve3184/panel/releases/download/latest/release-linux-x64.zip
sudo unzip release-linux-x64.zip && sudo rm release-linux-x64.zip

# 3. Setup Systemd Service
sudo useradd --system --home-dir /opt/panel --shell /usr/sbin/nologin panel 2>/dev/null || true
sudo chown -R panel:panel /opt/panel
# Optional, required only when using Docker instances:
sudo usermod -aG docker panel
sudo wget -O /etc/systemd/system/panel.service https://raw.githubusercontent.com/Steve3184/panel/main/panel.service
sudo systemctl daemon-reload
sudo systemctl enable panel
sudo systemctl start panel
```

**For Linux ARM64:**
```bash
# Use release-linux-arm64.zip instead
sudo wget https://github.com/Steve3184/panel/releases/download/latest/release-linux-arm64.zip
sudo unzip release-linux-arm64.zip && sudo rm release-linux-arm64.zip
# ...
```

**For Windows x64:**
```powershell
# Download release-win-x64.zip from:
# https://github.com/Steve3184/panel/releases/download/latest/release-win-x64.zip
# Extract and run: node src/server.js
```

#### Option 2: Build from Source 🛠️
*For developers or custom builds.*

<details>
<summary>Click to expand build instructions</summary>

1.  **Install Node.js 22:**
    ```bash
    curl -sL https://deb.nodesource.com/setup_22.x | bash -
    sudo apt install -y nodejs bubblewrap
    ```

2.  **Clone Repository:**
    ```bash
    sudo git clone https://github.com/Steve3184/panel.git /opt/panel
    cd /opt/panel
    ```

3.  **Install Dependencies & Build:**
    ```bash
    npm install
    cd frontend && npm install
    npm run build
    cd ..
    ```

4.  **Configure Service:**
    ```bash
    sudo useradd --system --home-dir /opt/panel --shell /usr/sbin/nologin panel 2>/dev/null || true
    sudo chown -R panel:panel /opt/panel
    # Optional, required only when using Docker instances:
    sudo usermod -aG docker panel
    sudo cp panel.service /etc/systemd/system/
    # Edit service file if path differs from /opt/panel
    sudo systemctl daemon-reload
    sudo systemctl enable panel
    sudo systemctl start panel
    ```
</details>

### Initial Setup
Access the panel at `http://localhost:3000`.
If no admin exists, you will be redirected to `/setup` to create the first account.

---

## ⚙️ Configuration

### Environment Variables
You can configure the panel via environment variables or by modifying `src/server.js`.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `SESSION_SECRET` | Optional session signing and encryption key (minimum 32 bytes). If unset, a persistent random key is generated in the data directory. | Generated |
| `PORT` | The port the server listens on. | `3000` |
| `PANEL_LANG` | Server-side language (e.g., `jp`, `en`, `zh_CN`). | `en` |
| `PANEL_DATA_DIR` | Optional directory for databases, sessions, workspaces, and temporary uploads. | Project directory |
| `TRUST_PROXY_HOPS` | Number of trusted reverse proxies in front of the panel. Leave unset for direct access. | `0` |
| `BWRAP_BIN` | Optional absolute path to the Bubblewrap executable. If unset, Panel checks the bundled binary and common system paths. | Auto-detected |

**Setting variables in `panel.service`:**
Edit `/etc/systemd/system/panel.service` and add `Environment` lines under `[Service]`:

```ini
[Service]
Environment="SESSION_SECRET=replace-with-at-least-32-random-bytes"
Environment="PORT=8080"
ExecStart=/usr/bin/node src/server.js
```
*Remember to run `sudo systemctl daemon-reload && sudo systemctl restart panel` after changes.*

Shell instances are sandboxed by default. Linux releases include a statically linked Bubblewrap binary, while source installations can use `BWRAP_BIN` or a system Bubblewrap installation. At startup, Panel executes a real sandbox capability probe. If the platform or kernel does not support the sandbox, the UI hides the switch, displays a security warning, and starts Shell instances without isolation regardless of their saved sandbox setting. Windows does not support Bubblewrap and therefore runs native Shell instances without this isolation; use Docker for untrusted Windows workloads.

When available, the sandbox exposes the instance working directory as `/workspace`, provides read-only system libraries, and hides panel databases, sessions, the Docker socket, and other host paths. Administrators can add up to 32 absolute host paths as read-only mounts for dependencies such as user site-packages, virtual environments, or external JDK installations. Additional paths keep their original location inside the sandbox and take effect after the instance restarts. Sensitive panel paths and reserved sandbox locations cannot be added. Administrators can also disable isolation per instance, but doing so gives the process the same filesystem and service access as the `panel` system account.

### 🔀 Reverse Proxy & Custom Domain

The panel works behind a reverse proxy (nginx, Caddy, FRP, etc.) with a custom domain. The required configuration depends on whether TLS is terminated by the proxy.

**HTTP proxy — no extra configuration needed**

This includes nginx in HTTP mode, Caddy without TLS, and FRP vhost HTTP mode. The proxy forwards the `Host` and `Origin` headers unchanged, so the panel's built-in origin check passes automatically.

**HTTPS-terminating proxy — set `TRUST_PROXY_HOPS=1`**

This includes nginx/Caddy handling TLS certificates and FRP HTTPS vhost mode. When the proxy strips TLS and forwards plain HTTP inward, Express cannot detect the original `https` protocol on its own. Without this setting the panel's origin check sees a protocol mismatch and returns 403.

Add to your `panel.service`:
```ini
Environment="TRUST_PROXY_HOPS=1"
```

Your proxy must also forward the `X-Forwarded-Proto: https` header — this is the default for most nginx and Caddy configurations.

> ⚠️ Do **not** set `TRUST_PROXY_HOPS` when the panel is directly internet-accessible without a proxy in front. Setting it in that case lets any client spoof the protocol header.

### 🌍 Remote Access (Gradio Tunnel)
The panel includes built-in tunneling capabilities using Gradio, allowing you to access your panel from the public internet without configuring router port forwarding or setting up FRP.

1.  Go to **Panel Settings** in the panel.
2.  Enable **Gradio Tunnel**.
3.  **Crucial**: Set a `Share Token`. This ensures your public URL remains constant. Without it, a random URL is generated on every restart.
4.  Wait a moment, then refresh the Settings page to see your public link.

### 🎨 UI Customization
Make the panel your own via the **Panel Settings** page:
-   **Title**: Change the browser tab and header title.
-   **Logo**: Upload a custom image for the top-left corner.
-   **Background**: Set a custom wallpaper for the login screen and dashboard.

---

## 📸 Screenshots

| Login Page | Instance Terminal | Panel Settings |
| :---: | :---: | :---: |
| <img src="images/1.webp" width="100%" alt="Login Page"/> | <img src="images/12.webp" width="100%" alt="Terminal"/> | <img src="images/4.webp" width="100%" alt="Panel Settings"/> |

| Docker Instance Settings | Compress Files |
| :---: | :---: |
| <img src="images/7.webp" width="100%" alt="Docker Instance Settings"/> | <img src="images/6.webp" width="100%" alt="Compress Files"/> |

---

## 🤝 Contributing

Contributions make the open-source community an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

## ⚠️ Disclaimer

**Windows Compatibility**: This panel is primarily developed for **Linux** environments. While it may run on Windows, functionality is not guaranteed and compatibility issues may arise.

<br>

<p align="center">
  <small><i>This repository contains code that was generated or assisted by AI.</i></small>
</p>
