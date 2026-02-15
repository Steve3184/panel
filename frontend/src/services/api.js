// 封装所有 API 请求，方便管理和处理错误

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(url, options = {}) {
  const defaultHeaders = {
    'Accept': 'application/json',
  };

  // 如果 body 是 FormData 实例，则不设置 Content-Type，让浏览器自动设置
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const config = {
    method: 'GET', // 默认 GET 请求
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    let errorMessage = `HTTP error! status: ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch (e) {
      // 响应不是 JSON 或解析失败
    }
    throw new ApiError(errorMessage, response.status);
  }

  // 如果响应状态码是 204 No Content，则不尝试解析 JSON
  if (response.status === 204) {
    return null;
  }
  
  return response.json();
}

export default {
  // Session & Setup
  checkSession: () => request('/api/session'),
  login: (credentials) => request('/api/login', { method: 'POST', body: JSON.stringify(credentials) }),
  logout: () => request('/api/logout', { method: 'POST' }),
  setup: (admin) => request('/api/setup', { method: 'POST', body: JSON.stringify(admin) }),

  // Instances
  getInstances: () => request('/api/instances'),
  createInstance: (data) => request('/api/instances', { method: 'POST', body: JSON.stringify(data) }),
  updateInstance: (id, data) => request(`/api/instances/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteInstance: (id, deleteData) => request(`/api/instances/${id}?deleteData=${deleteData}`, { method: 'DELETE' }),
  instanceAction: (id, action) => request(`/api/instances/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
  getComposeContainers: (id) => request(`/api/instances/${id}/containers`),
  
  // Users
  getUsers: () => request('/api/users'),
  createUser: (userData) => request('/api/users', { method: 'POST', body: JSON.stringify(userData) }),
  deleteUser: (userId) => request(`/api/users/${userId}`, { method: 'DELETE' }),
  updateUserPermission: (instanceId, userId, permissions) => request(`/api/instances/${instanceId}/permissions/${userId}`, { method: 'PUT', body: JSON.stringify(permissions) }),
  updateUserRole: (userId, role) => request(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  changePassword: (userId, passwords) => request(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(passwords) }),
  updateUsername: (userId, username) => request(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify({ username }) }),

  // File Manager
  getFiles: (instanceId, path) => request(`/api/instances/${instanceId}/files/${encodeURIComponent(path)}`),
  getFileContent: (instanceId, path) => request(`/api/instances/${instanceId}/file-content/${encodeURIComponent(path)}`),
  createFolder: (instanceId, path, name) => request(`/api/instances/${instanceId}/files/${encodeURIComponent(path)}`, { method: 'POST', body: JSON.stringify({ name }) }),
  createFile: (instanceId, path, name) => request(`/api/instances/${instanceId}/files/${encodeURIComponent(path)}`, { method: 'PUT', body: JSON.stringify({ name, content: '' }) }),
  rename: (instanceId, oldPath, newName) => request(`/api/instances/${instanceId}/rename`, { method: 'POST', body: JSON.stringify({ oldPath, newName }) }),
  delete: (instanceId, path) => request(`/api/instances/${instanceId}/files/${encodeURIComponent(path)}`, { method: 'DELETE' }),
  deleteMultiple: (instanceId, filePaths) => request(`/api/instances/${instanceId}/delete-multiple`, { method: 'POST', body: JSON.stringify({ filePaths }) }),
  copy: (instanceId, files, destination) => request(`/api/instances/${instanceId}/copy`, { method: 'POST', body: JSON.stringify({ files, destination }) }),
  move: (instanceId, files, destination) => request(`/api/instances/${instanceId}/move`, { method: 'POST', body: JSON.stringify({ files, destination }) }),
  extract: (instanceId, filePath, destinationPath) => request(`/api/instances/${instanceId}/extract`, { method: 'POST', body: JSON.stringify({ filePath, destinationPath }) }),
  compress: (instanceId, filesToCompress, destinationPath, outputName, format, level) => request(`/api/instances/${instanceId}/compress`, { method: 'POST', body: JSON.stringify({ filesToCompress, destinationPath, outputName, format, level }) }),

  // Logs
  getLogs: () => request('/api/logs'),
  getLogContent: (filename) => request(`/api/logs/${filename}`),

  // Panel Settings
  getPanelSettings: () => request('/api/panel-settings'),
  updatePanelSettings: (settings) => request('/api/panel-settings', { method: 'POST', body: JSON.stringify(settings) }),
  uploadBackgroundImage: (formData) => request('/api/panel-settings/background', { method: 'POST', body: formData, headers: {} }),
  getBackgroundImage: () => fetch('/api/panel-settings/background', { method: 'GET', headers: {} }),
  deleteBackgroundImage: () => request('/api/panel-settings/background', { method: 'DELETE' }),
  restartPanel: () => request('/api/panel-settings/restart', { method: 'POST' }),
};