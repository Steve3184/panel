import path from 'path';
import { DB_PATH, SESSIONS_PATH, UPLOAD_TEMP_DIR } from '../config.js';
import { buildBubblewrapArguments, getShellSandboxCapability } from './sandboxCapability.js';

export const MAX_TERMINAL_HISTORY_LINES = 2_000;
export const MAX_TERMINAL_HISTORY_BYTES = 2 * 1024 * 1024;
export const MAX_TERMINAL_MESSAGE_BYTES = 32 * 1024;

const SAFE_HOST_ENV_KEYS = ['PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ'];
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SENSITIVE_PANEL_PATHS = [DB_PATH, SESSIONS_PATH, UPLOAD_TEMP_DIR].map(value => path.resolve(value));

function pathContains(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertSandboxWorkspaceSafe(instanceCwd) {
    const workspacePath = path.resolve(instanceCwd);
    if (SENSITIVE_PANEL_PATHS.some(sensitivePath => pathContains(workspacePath, sensitivePath) || pathContains(sensitivePath, workspacePath))) {
        throw new Error('Shell sandbox workspace overlaps a sensitive panel data directory.');
    }
}

export function appendTerminalHistory(history, output) {
    let result = `${history || ''}${output || ''}`;
    const resultBuffer = Buffer.from(result);
    if (resultBuffer.length > MAX_TERMINAL_HISTORY_BYTES) {
        result = resultBuffer.subarray(resultBuffer.length - MAX_TERMINAL_HISTORY_BYTES).toString('utf8');
    }

    const lines = result.split('\n');
    if (lines.length > MAX_TERMINAL_HISTORY_LINES) {
        result = lines.slice(-MAX_TERMINAL_HISTORY_LINES).join('\n');
    }
    return result;
}

export function truncateTerminalOutput(output, maxBytes = MAX_TERMINAL_MESSAGE_BYTES) {
    const buffer = Buffer.from(output || '');
    if (buffer.length <= maxBytes) return output || '';

    let start = buffer.length - maxBytes;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
    return buffer.subarray(start).toString('utf8');
}

export function buildInstanceEnvironment(instanceEnv = {}, homeDirectory = '/workspace') {
    const environment = {};
    for (const key of SAFE_HOST_ENV_KEYS) {
        if (typeof process.env[key] === 'string') environment[key] = process.env[key];
    }
    for (const [key, value] of Object.entries(instanceEnv || {})) {
        if (VALID_ENV_KEY.test(key) && ['string', 'number', 'boolean'].includes(typeof value)) {
            environment[key] = String(value);
        }
    }

    environment.HOME = homeDirectory;
    environment.TMPDIR = '/tmp';
    environment.TERM = 'xterm-color';
    environment.PATH ||= '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
    return environment;
}

export function buildShellLaunch(instanceCwd, command, instanceEnv = {}, sandboxEnabled = true) {
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    if (!sandboxEnabled) {
        return {
            file: shell,
            args: ['-c', command],
            cwd: instanceCwd,
            env: buildInstanceEnvironment(instanceEnv, instanceCwd),
            sandboxed: false
        };
    }
    const sandboxCapability = getShellSandboxCapability();
    if (process.platform === 'linux' && !sandboxCapability.checked) {
        throw new Error('Shell sandbox capability was not initialized.');
    }
    if (!sandboxCapability.supported) {
        return {
            file: shell,
            args: ['-c', command],
            cwd: instanceCwd,
            env: buildInstanceEnvironment(instanceEnv, instanceCwd),
            sandboxed: false,
            sandboxReason: sandboxCapability.reason
        };
    }
    assertSandboxWorkspaceSafe(instanceCwd);

    return {
        file: sandboxCapability.binary,
        args: buildBubblewrapArguments(instanceCwd, command, shell),
        cwd: instanceCwd,
        env: buildInstanceEnvironment(instanceEnv),
        sandboxed: true
    };
}
