import fs from 'fs';
import path from 'path';
import { DB_PATH, SESSIONS_PATH, UPLOAD_TEMP_DIR } from '../config.js';
import { buildBubblewrapArguments, DEFAULT_SANDBOX_PATH, getShellSandboxCapability } from './sandboxCapability.js';

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
].map(resolvePathThroughExistingAncestors);
const RESERVED_SANDBOX_TREES = ['/proc', '/dev', '/sys', '/workspace'];
const RESERVED_SANDBOX_MOUNT_TREES = [...RESERVED_SANDBOX_TREES, '/tmp'];

function resolvePathThroughExistingAncestors(value) {
    const resolvedPath = path.resolve(value);
    const missingSegments = [];
    let existingPath = resolvedPath;

    while (!fs.existsSync(existingPath)) {
        const parentPath = path.dirname(existingPath);
        if (parentPath === existingPath) return resolvedPath;
        missingSegments.unshift(path.basename(existingPath));
        existingPath = parentPath;
    }

    try {
        return path.join(fs.realpathSync.native(existingPath), ...missingSegments);
    } catch {
        return resolvedPath;
    }
}

function pathContains(parentPath, childPath) {
    const relative = path.relative(parentPath, childPath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertSandboxWorkspaceSafe(instanceCwd) {
    const workspacePath = path.resolve(instanceCwd);
    let realWorkspacePath;
    try {
        realWorkspacePath = fs.realpathSync.native(workspacePath);
    } catch {
        throw new Error('Shell sandbox workspace must exist and be accessible.');
    }
    if (realWorkspacePath !== workspacePath) {
        throw new Error('Shell sandbox workspace must not contain symbolic links.');
    }
    if (SENSITIVE_HOST_PATHS.some(sensitivePath => pathContains(realWorkspacePath, sensitivePath) || pathContains(sensitivePath, realWorkspacePath))) {
        throw new Error('Shell sandbox workspace overlaps a sensitive panel data directory.');
    }
    return realWorkspacePath;
}

export function assertSandboxWorkspaceDestinationSafe(instanceCwd) {
    const destinationPath = path.resolve(instanceCwd);
    const overlapsReservedTree = RESERVED_SANDBOX_TREES.some(reservedPath =>
        pathContains(reservedPath, destinationPath) || pathContains(destinationPath, reservedPath)
    );
    if (overlapsReservedTree) {
        throw new Error('Shell sandbox original workspace path overlaps a reserved sandbox path.');
    }
}

function assertSandboxAllowedPathSafe(allowedPath) {
    const resolvedPath = path.resolve(allowedPath);
    const overlaps = (candidate, checkedPath) => pathContains(candidate, checkedPath) || pathContains(checkedPath, candidate);
    const assertPathPolicy = checkedPath => {
        if (SENSITIVE_HOST_PATHS.some(candidate => overlaps(candidate, checkedPath))) {
            throw new Error('Shell sandbox allowed path overlaps a sensitive host path.');
        }
        if (RESERVED_SANDBOX_MOUNT_TREES.some(candidate => overlaps(path.resolve(candidate), checkedPath))) {
            throw new Error('Shell sandbox allowed path overlaps a reserved sandbox path.');
        }
    };

    assertPathPolicy(resolvedPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error('Shell sandbox allowed paths must exist.');
    }
    const realPath = fs.realpathSync.native(resolvedPath);
    assertPathPolicy(realPath);
    const stats = fs.statSync(realPath);
    if (!stats.isFile() && !stats.isDirectory()) {
        throw new Error('Shell sandbox allowed paths must be regular files or directories.');
    }
    return realPath;
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
            const stringValue = String(value);
            if (stringValue.includes('\0')) throw new Error('Shell environment values must not contain null bytes.');
            environment[key] = stringValue;
        }
    }

    environment.HOME = homeDirectory;
    environment.PWD = homeDirectory;
    environment.TMPDIR = '/tmp';
    environment.TERM = 'xterm-color';
    environment.PATH ||= DEFAULT_SANDBOX_PATH;
    return environment;
}

export function buildSandboxLauncherEnvironment() {
    const environment = {};
    for (const key of SAFE_HOST_ENV_KEYS) {
        if (typeof process.env[key] === 'string') environment[key] = process.env[key];
    }
    environment.PATH ||= DEFAULT_SANDBOX_PATH;
    environment.TERM = 'xterm-color';
    return environment;
}

function buildSandboxAllowedMounts(allowedPaths, workspacePath, workspaceDestination) {
    return allowedPaths.map(destination => {
        const source = assertSandboxAllowedPathSafe(destination);
        if (pathContains(workspacePath, source) || pathContains(workspaceDestination, destination)) {
            throw new Error('Shell sandbox allowed path overlaps the writable workspace.');
        }
        return { source, destination };
    });
}

export function buildShellLaunch(
    instanceCwd,
    command,
    instanceEnv = {},
    sandboxEnabled = true,
    sandboxAllowedPaths = [],
    sandboxPreserveWorkspacePath = false
) {
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
        if (process.platform !== 'linux') {
            return {
                file: shell,
                args: ['-c', command],
                cwd: instanceCwd,
                env: buildInstanceEnvironment(instanceEnv, instanceCwd),
                sandboxed: false,
                sandboxReason: sandboxCapability.reason
            };
        }
        throw new Error(`Shell sandbox is required but unavailable: ${sandboxCapability.reason || 'unknown reason'}.`);
    }
    const workspacePath = assertSandboxWorkspaceSafe(instanceCwd);
    if (sandboxPreserveWorkspacePath) assertSandboxWorkspaceDestinationSafe(instanceCwd);
    const allowedPaths = normalizeSandboxAllowedPaths(sandboxAllowedPaths);
    const workspaceDestination = sandboxPreserveWorkspacePath ? path.resolve(instanceCwd) : '/workspace';
    const allowedMounts = buildSandboxAllowedMounts(allowedPaths, workspacePath, workspaceDestination);
    const commandEnvironment = buildInstanceEnvironment(instanceEnv, workspaceDestination);

    return {
        file: sandboxCapability.binary,
        args: buildBubblewrapArguments(
            workspacePath,
            command,
            shell,
            allowedMounts,
            workspaceDestination,
            commandEnvironment
        ),
        cwd: workspacePath,
        env: buildSandboxLauncherEnvironment(),
        sandboxed: true
    };
}
