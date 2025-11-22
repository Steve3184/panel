# The Panel

<div align="center">

![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange?style=flat-square)

[English](README.md) | **简体中文**

**一款强大、易用且基于 Web 的服务器管理面板。**

*通过现代化的用户界面，简化实例、文件及用户的管理流程。无论您是管理原始 Shell 命令还是 Docker 容器，Panel 都能为您提供流畅的控制体验。*

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [配置指南](#-配置指南) • [截图预览](#-截图预览)

</div>

---

## ✨ 功能特性

### 🖥️ 实例管理
全面掌控您的服务，完美支持 **Shell** 和 **Docker** 环境。
-   **生命周期控制**：一键创建、启动、停止、重启及销毁实例。
-   **Docker 深度集成**：轻松配置镜像、端口、挂载卷、工作目录及自定义命令。
-   **自动化管理**：支持开机自启、失败自动重启及退出自动删除。
-   **系统监控**：实时 CPU 和内存使用率追踪。
-   **Web 终端**：为每个实例配备功能完整的交互式终端。
-   <details><summary>📷 <i>查看截图</i></summary><br><img src="images/5.webp" alt="Instance Overview"><br><img src="images/12.webp" alt="Instance Terminal"><br><img src="images/2.webp" alt="Instance Settings"></details>

### 👥 用户与 RBAC 权限管理
专为团队设计的安全且灵活的用户管理系统。
-   **角色体系**：区分 `admin`（管理员）和 `user`（普通用户）角色。
-   **细粒度控制**：针对每个实例定义权限：
    -   *终端权限*：无权限、只读、读/写或完全控制。
    -   *文件权限*：独立的文件管理访问开关。
-   **账户安全**：安全的密码更新及账户管理机制。
-   <details><summary>📷 <i>查看截图</i></summary><br><img src="images/11.webp" alt="User Management"><br><img src="images/10.webp" alt="Instance Permissions"></details>

### 📂 高级文件管理
直接在浏览器中体验桌面级的文件管理器。
-   **文件操作**：浏览、创建、重命名、复制、移动（剪切-粘贴）及删除。
-   **传输功能**：支持大文件分片上传及便捷下载。
-   **代码编辑器**：集成 Monaco Editor（VS Code 风格），支持语法高亮及 WebSocket 实时同步。
-   **压缩归档**：支持直接在服务器端进行压缩（zip, 7z, tar.gz 等）和解压（zip, tar, bz2 等）。
-   **安全机制**：针对二进制/系统文件的黑名单保护。
-   <details><summary>📷 <i>查看截图</i></summary><br><img src="images/9.webp" alt="File Browser"><br><img src="images/8.webp" alt="Online File Editor"></details>

### 🔗 连接与访问
-   **WebDAV 支持**：通过 WebDAV 本地挂载实例文件 (`/api/dav/<instance-id>/`)。
-   **Gradio 隧道**：内置远程访问功能（无需配置 FRP 或端口转发）。
-   **国际化支持**：完整的 i18n 支持（中文、英文、日文等）。
-   **响应式设计**：完美适配手机、平板及桌面端设备。

---

## 🚀 快速开始

### 环境要求
*   **Node.js**：v22 或更高版本
*   **Unzip**：用于解压 Release 包
*   **Docker**：（可选）用于容器管理
*   **7-Zip**：（可选）用于高级压缩功能

### 安装指南

#### 选项 1：使用 Release 包安装（推荐）⚡
*部署速度最快，无需构建*

```bash
# 1. 安装 Node.js 22 及工具
curl -sL https://deb.nodesource.com/setup_22.x | bash -
sudo apt install -y nodejs unzip

# 2. 下载并解压
sudo mkdir -p /opt/panel && cd /opt/panel
sudo wget https://github.com/Steve3184/panel/releases/download/latest-build/release.zip
sudo unzip release.zip && sudo rm release.zip

# 3. 安装生产环境依赖
sudo npm install --prod

# 4. 配置 Systemd 服务
sudo wget -O /etc/systemd/system/panel.service https://raw.githubusercontent.com/Steve3184/panel/main/panel.service
sudo systemctl daemon-reload
sudo systemctl enable panel
sudo systemctl start panel
```

#### 选项 2：源码编译安装 🛠️
*适用于开发者或需要自定义构建的场景*

<details>
<summary>点击展开构建步骤</summary>

1.  **安装 Node.js 22:**
    ```bash
    curl -sL https://deb.nodesource.com/setup_22.x | bash -
    sudo apt install -y nodejs
    ```

2.  **克隆仓库:**
    ```bash
    sudo git clone https://github.com/Steve3184/panel.git /opt/panel
    cd /opt/panel
    ```

3.  **安装依赖并构建:**
    ```bash
    npm install
    cd frontend && npm install
    npm run build --prefix frontend
    ```

4.  **配置服务:**
    ```bash
    sudo cp panel.service /etc/systemd/system/
    # 如果安装路径不是 /opt/panel，请编辑服务文件修改路径
    sudo systemctl daemon-reload
    sudo systemctl enable panel
    sudo systemctl start panel
    ```
</details>

### 初始化设置
访问 `http://localhost:3000` 进入面板。
如果系统中尚无管理员，页面将自动跳转至 `/setup` 以创建首个账户。

---

## ⚙️ 配置指南

### 环境变量
您可以通过环境变量或修改 `src/server.js` 来配置面板。

| 变量名 | 描述 | 默认值 |
| :--- | :--- | :--- |
| `SESSION_SECRET` | 用于签名会话 ID cookie 的密钥。**生产环境中请务必修改此项。** | |
| `PORT` | 服务器监听的端口。 | `3000` |
| `PANEL_LANG` | 服务端语言设置（例如 `jp`, `en`, `zh_CN`）。 | `en` |

**在 `panel.service` 中设置变量：**
编辑 `/etc/systemd/system/panel.service` 并在 `[Service]` 下方添加 `Environment` 行：

```ini
[Service]
Environment="SESSION_SECRET=MySuperSecretKey123"
Environment="PORT=8080"
ExecStart=/usr/bin/node src/server.js
```
*注意：修改后请运行 `sudo systemctl daemon-reload && sudo systemctl restart panel` 使配置生效。*

### 🌍 远程访问 (Gradio 隧道)
面板内置了基于 Gradio 的隧道功能，无需配置路由器端口转发或搭建 FRP，即可在公网访问您的面板。

1.  进入面板的 **面板设置**。
2.  启用 **Gradio Tunnel**。
3.  **重要提示**：请设置 `Share Token`（共享令牌）。这能确保您的公网 URL 保持不变。如果不设置，每次重启都会生成一个随机 URL。
4.  稍等片刻，刷新设置页面即可查看生成的公网链接。

### 🎨 界面个性化
通过 **面板设置** 页面打造属于您的面板：
-   **标题**：修改浏览器标签页和顶栏标题。
-   **Logo**：上传自定义图片作为左上角 Logo。
-   **背景**：设置登录页和仪表盘的自定义壁纸。

---

## 📸 截图预览

| 登录页 | 实例终端 | 面板设置 |
| :---: | :---: | :---: |
| <img src="images/1.webp" width="100%" alt="Login Page"/> | <img src="images/12.webp" width="100%" alt="Terminal"/> | <img src="images/4.webp" width="100%" alt="Panel Settings"/> |

| Docker 实例设置 | 文件压缩 |
| :---: | :---: |
| <img src="images/7.webp" width="100%" alt="Docker Instance Settings"/> | <img src="images/6.webp" width="100%" alt="Compress Files"/> |

---

## 🤝 贡献指南

开源社区之所以如此迷人，是因为这里是学习、激发灵感和创造的乐土。我们**非常感谢**您做出的任何贡献。

## 📄 许可证

本项目基于 MIT 许可证分发。详情请参阅 `LICENSE` 文件。

## ⚠️ 免责声明

**Windows 兼容性**：本面板主要针对 **Linux** 环境开发。虽然它可能在 Windows 上运行，但不保证功能完整性，且可能会出现兼容性问题。

<br>

<p align="center">
  <small><i>本项目包含由 AI 生成或辅助生成的代码</i></small>
</p>