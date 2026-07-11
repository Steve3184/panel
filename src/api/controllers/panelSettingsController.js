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

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

async function loadSettings() {
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf8');
    const loaded = JSON.parse(data);
    panelSettings = {
      ...panelSettings,
      ...loaded,
      // Deep-merge gradioTunnel so a missing or non-object value never loses the sub-structure
      gradioTunnel: {
        ...panelSettings.gradioTunnel,
        ...(loaded.gradioTunnel && typeof loaded.gradioTunnel === 'object'
          ? loaded.gradioTunnel
          : {})
      }
    };
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
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(panelSettings, null, 2), 'utf8');
    await fs.chmod(SETTINGS_FILE, 0o600);
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
export const panelSettingsReady = loadSettings().then(startTunnel);

export const getPanelSettings = (req, res) => {
  res.json({
    ...panelSettings,
    gradioTunnelUrl: currentTunnel ? currentTunnel.url : null
  });
};

export const getPublicPanelSettings = (req, res) => {
  res.json({
    panelName: panelSettings.panelName,
    panelLogo: panelSettings.panelLogo
  });
};

export const updatePanelSettings = async (req, res) => {
  const oldPanelPort = panelSettings.panelPort;
  const oldGradioTunnelEnabled = panelSettings.gradioTunnel.enabled;

  const { panelName, panelLogo, gradioTunnel, panelPort } = req.body;

  if (panelName !== undefined) {
    if (typeof panelName !== 'string' || panelName.length > 128) {
      return res.status(400).json({ message: 'server.invalid_action' });
    }
    panelSettings.panelName = panelName;
  }
  if (panelLogo !== undefined) {
    if (panelLogo !== '' && typeof panelLogo === 'string') {
      // Only allow same-origin relative paths or data:image/... URIs
      const isDataImage = panelLogo.startsWith('data:image/');
      const isRelative = panelLogo.startsWith('/');
      if (!isDataImage && !isRelative) {
        return res.status(400).json({ message: 'server.invalid_action' });
      }
    }
    panelSettings.panelLogo = panelLogo;
  }
  if (gradioTunnel !== undefined) panelSettings.gradioTunnel = gradioTunnel;
  if (panelPort !== undefined) {
    const port = Number.parseInt(panelPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ message: 'server.invalid_port' });
    }
    panelSettings.panelPort = port;
  }

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
  let responseSent = false;

  const sendOnce = (status, body) => {
    if (responseSent) return;
    responseSent = true;
    res.status(status).json(body);
  };

  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    if (fieldname !== 'backgroundImage') {
      file.resume();
      return sendOnce(400, { message: 'server.invalid_action' });
    }

    file.on('data', (data) => {
      fileBuffer = Buffer.concat([fileBuffer, data]);
      fileSize += data.length;
      if (fileSize > MAX_SIZE) {
        req.unpipe(busboy); // Stop receiving data
        file.destroy(); // Destroy the file stream
        sendOnce(413, { message: 'server.file_size_exceeds_limit' });
      }
    });

    file.on('end', async () => {
      if (responseSent) return;
      try {
        if (!detectImageMime(fileBuffer)) {
          return sendOnce(400, { message: 'server.invalid_file_details' });
        }
        await fs.writeFile(BGIMAGE_PATH, fileBuffer, { mode: 0o600 });
        await fs.chmod(BGIMAGE_PATH, 0o600);
        sendOnce(200, { message: 'server.ok' });
      } catch (error) {
        console.error('Error saving background image:', error);
        sendOnce(500, { message: 'server.internal_server_error' });
      }
    });
  });

  busboy.on('error', (err) => {
    console.error('Busboy error:', err);
    sendOnce(500, { message: 'server.file_upload_chunk_failed_parsing', error: err.message });
  });

  req.pipe(busboy);
};

export const getBackgroundImage = async (req, res) => {
  try {
    await fs.access(BGIMAGE_PATH);
    const header = await fs.readFile(BGIMAGE_PATH);
    const mime = detectImageMime(header);
    if (!mime) return res.status(415).json({ message: 'server.invalid_file_details' });
    res.type(mime);
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
