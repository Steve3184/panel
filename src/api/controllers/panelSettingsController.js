import fs from 'fs/promises';
import path from 'path';
import { setupTunnel, Tunnel, getRandomToken } from '../../utils/tunnel.js'; // 导入 Gradio Tunnel 相关函数
import { SETTINGS_FILE, BGIMAGE_PATH } from '../../config.js'
import Busboy from 'busboy';

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

export const uploadBackgroundImage = async (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  if (!busboy) {
    return res.status(400).json({ message: 'server.internal_server_error' });
  }

  let fileBuffer = Buffer.from('');
  let fileSize = 0;
  const MAX_SIZE = 4 * 1024 * 1024; // 4MB

  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    if (fieldname !== 'backgroundImage') {
      file.resume();
      return res.status(400).json({ message: 'server.invalid_action' });
    }

    file.on('data', (data) => {
      fileBuffer = Buffer.concat([fileBuffer, data]);
      fileSize += data.length;
      if (fileSize > MAX_SIZE) {
        req.unpipe(busboy); // Stop receiving data
        file.destroy(); // Destroy the file stream
        return res.status(413).json({ message: 'server.file_size_exceeds_limit' });
      }
    });

    file.on('end', async () => {
      if (fileSize > MAX_SIZE) {
        return; // Response already sent
      }
      try {
        await fs.writeFile(BGIMAGE_PATH, fileBuffer);
        res.status(200).json({ message: 'server.ok' });
      } catch (error) {
        console.error('Error saving background image:', error);
        res.status(500).json({ message: 'server.internal_server_error' });
      }
    });
  });

  busboy.on('error', (err) => {
    console.error('Busboy error:', err);
    res.status(500).json({ message: 'server.file_upload_chunk_failed_parsing', error: err.message });
  });

  req.pipe(busboy);
};

export const getBackgroundImage = async (req, res) => {
  try {
    await fs.access(BGIMAGE_PATH);
    res.sendFile(path.resolve(BGIMAGE_PATH));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'server.file_not_found' });
    }
    res.status(500).json({ message: 'server.internal_server_error' });
  }
};

export const deleteBackgroundImage = async (req, res) => {
  try {
    await fs.unlink(BGIMAGE_PATH);
    res.status(200).json({ message: 'server.ok' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ message: 'server.file_not_found' });
    }
    res.status(500).json({ message: 'server.internal_server_error' });
  }
};

export const restartPanel = (req, res) => {
  console.log('restarting...');
  res.json({ message: 'server.ok' });
  setTimeout(() => {
    process.exit(0);
  }, 1000);
};