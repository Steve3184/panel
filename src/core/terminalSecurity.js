import fs from 'fs';
import path from 'path';
import { DB_PATH, SESSIONS_PATH, UPLOAD_TEMP_DIR } from '../config.js';
import { buildBubblewrapArguments, getShellSandboxCapability } from './sandboxCapability.js';

export const MAX_TERMINAL_HISTORY_LINES = 2_000;
export const MAX_TERMINAL_HISTORY_BYTES = 2 * 1024 * 1024;
export const MAX_TERMINAL_MESSAGE_BYTES = 32 * 1024;

const SAFE_HOST_ENV_KEYS = ['PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ'];
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SANDBOX_ALLOWED_PATHS = 32;
const SENSITIVE_HOST_PATHS = [
    DB_PATH,
    SESSIONS_PATH,
    UPLOAD_TEMP_DIR,
    '/var/run/docker.sock',
    '/run/docker.sock'
].map(value => path.resolve(value));
const RESERVED_SANDBOX_TREES = ['/proc', '/dev', '/sys', '/workspace'];

function pathContains(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertSandboxWorkspaceSafe(instanceCwd) {
    const workspacePath = path.resolve(instanceCwd);
    if (SENSITIVE_HOST_PATHS.some(sensitivePath => pathContains(workspacePath, sensitivePath) || pathContains(sensitivePath, workspacePath))) {
        throw new Error('Shell sandbox workspace overlaps a sensitive panel data directory.');
    }
}

function assertSandboxAllowedPathSafe(allowedPath) {
    const resolvedPath = path.resolve(allowedPath);
    const realPath = fs.existsSync(resolvedPath) ? fs.realpathSync(resolvedPath) : resolvedPath;
    const overlaps = candidate => pathContains(candidate, realPath) || pathContains(realPath, candidate);

    if (SENSITIVE_HOST_PATHS.some(overlaps)) {
        throw new Error('Shell sandbox allowed path overlaps a sensitive host path.');
    }
    if (RESERVED_SANDBOX_TREES.some(reservedPath => overlaps(path.resolve(reservedPath))) || pathContains(realPath, '/tmp')) {
        throw new Error('Shell sandbox allowed path overlaps a reserved sandbox path.');
    }
}

export function normalizeSandboxAllowedPaths(allowedPaths = []) {
    if (allowedPaths === undefined || allowedPaths === null) return [];
    if (!Array.isArray(allowedPaths) || allowedPaths.length > MAX_SANDBOX_ALLOWED_PATHS) {
        throw new Error('Shell sandbox allowed paths must be an array with at most 32 entries.');
    }

    const normalizedPaths = [];
    const seen = new Set();
    for (const value of allowedPaths) {
        if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value.trim())) {
            throw new Error('Shell sandbox allowed paths must be absolute paths.');
        }
        const normalizedPath = path.resolve(value.trim());
        assertSandboxAllowedPathSafe(normalizedPath);
        if (!seen.has(normalizedPath)) {
            seen.add(normalizedPath);
            normalizedPaths.push(normalizedPath);
        }
    }
    return normalizedPaths;
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

export function buildShellLaunch(instanceCwd, command, instanceEnv = {}, sandboxEnabled = true, sandboxAllowedPaths = []) {
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
    const allowedPaths = normalizeSandboxAllowedPaths(sandboxAllowedPaths);

    return {
        file: sandboxCapability.binary,
        args: buildBubblewrapArguments(instanceCwd, command, shell, allowedPaths),
        cwd: instanceCwd,
        env: buildInstanceEnvironment(instanceEnv),
        sandboxed: true
    };
}
