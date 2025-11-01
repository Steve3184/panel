import fs  from 'fs/promises';
import { setupTunnel, Tunnel, getRandomToken } from '../../utils/tunnel.js'; // 导入 Gradio Tunnel 相关函数
import { SETTINGS_FILE } from '../../config.js'

export let panelSettings = {
  panelName: 'Panel',
  panelLogo: '',
  gradioTunnel: {
    enabled: false,
    shareToken: ''
  },
  panelPort: 3000
};

let currentTunnel = null; // 用于存储当前的 Gradio Tunnel 实例

async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    panelSettings = { ...panelSettings, ...JSON.parse(data) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      await saveSettings();
    } else {
      console.error('Error loading settings:', error);
      process.exit(1);
    }
  }
}

async function saveSettings() {
  try {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(panelSettings, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

async function startTunnel() {
  if (panelSettings.gradioTunnel.enabled) {
    try {
      const shareToken = panelSettings.gradioTunnel.shareToken || getRandomToken();
      currentTunnel = await setupTunnel('127.0.0.1', panelSettings.panelPort, shareToken);
      console.log('Tunnel started on:', currentTunnel.url);
    } catch (error) {
      console.error('Tunnel error:', error);
    }
  }
}
// Load settings on startup
loadSettings().then(startTunnel);

export const getPanelSettings = (req, res) => {
  res.json({
    ...panelSettings,
    gradioTunnelUrl: currentTunnel ? currentTunnel.url : null
  });
};

export const updatePanelSettings = async (req, res) => {
  const oldPanelPort = panelSettings.panelPort;
  const oldGradioTunnelEnabled = panelSettings.gradioTunnel.enabled;

  const { panelName, panelLogo, gradioTunnel, panelPort } = req.body;

  if (panelName !== undefined) panelSettings.panelName = panelName;
  if (panelLogo !== undefined) panelSettings.panelLogo = panelLogo;
  if (gradioTunnel !== undefined) panelSettings.gradioTunnel = gradioTunnel;
  if (panelPort !== undefined) panelSettings.panelPort = panelPort;

  await saveSettings();

  // 处理 Gradio Tunnel
  if (panelSettings.gradioTunnel.enabled && (!oldGradioTunnelEnabled || oldPanelPort !== panelSettings.panelPort)) {
    // 如果 Gradio Tunnel 启用，并且之前未启用或端口发生变化，则启动/重启隧道
    if (currentTunnel) {
      currentTunnel.kill();
      currentTunnel = null;
    }
    await startTunnel();
  } else if (!panelSettings.gradioTunnel.enabled && oldGradioTunnelEnabled) {
    // 如果 Gradio Tunnel 禁用，并且之前是启用的，则关闭隧道
    if (currentTunnel) {
      currentTunnel.kill();
      currentTunnel = null;
    }
  }

  res.json({ message: 'server.ok', settings: panelSettings });
};

export const restartPanel = (req, res) => {
  console.log('restarting...');
  res.json({ message: 'server.ok' });
  // 延迟退出，确保响应已发送
  setTimeout(() => {
    process.exit(0);
  }, 1000);
};