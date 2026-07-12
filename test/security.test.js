import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'fs-extra';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import helmet from 'helmet';

import { isPathWithinRoot, resolvePathWithinRoot } from '../src/core/fileManager.js';
import { serializeInstance } from '../src/api/serializers/instanceSerializer.js';
import { CONTENT_SECURITY_POLICY_DIRECTIVES, isStrongEnoughPassword } from '../src/utils/security.js';
import { isAuthenticated } from '../src/api/middleware/auth.js';
import { readDb, writeDb } from '../src/data/db.js';
import { containerBelongsToComposeInstance } from '../src/core/dockerSecurity.js';
import { getWebDavRelativeDestination } from '../src/api/controllers/webdavController.js';
import {
    appendTerminalHistory,
    truncateTerminalOutput,
    assertSandboxWorkspaceSafe,
    assertSandboxWorkspaceDestinationSafe,
    buildInstanceEnvironment,
    buildShellLaunch,
    normalizeSandboxAllowedPaths,
    MAX_TERMINAL_HISTORY_BYTES,
    MAX_TERMINAL_HISTORY_LINES
} from '../src/core/terminalSecurity.js';
import { DB_PATH } from '../src/config.js';
import { getShellSandboxCapability, initializeShellSandboxCapability } from '../src/core/sandboxCapability.js';

let tempRoot;
let allowedPathRoot;

before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-security-'));
    allowedPathRoot = await fs.mkdtemp(path.join(os.homedir(), '.panel-security-allowed-'));
    await fs.ensureDir(path.join(tempRoot, 'nested'));
    await fs.symlink(os.tmpdir(), path.join(tempRoot, 'outside-link'));
    await initializeShellSandboxCapability();
});

after(async () => {
    await fs.remove(tempRoot);
    await fs.remove(allowedPathRoot);
});

test('path containment rejects prefix and parent traversal', async () => {
    assert.equal(isPathWithinRoot('/srv/workspaces/abc', '/srv/workspaces/abcd/secret'), false);
    await assert.rejects(resolvePathWithinRoot(tempRoot, '../outside'), /Access denied/);
    await assert.rejects(resolvePathWithinRoot(tempRoot, '/etc/passwd'), /Access denied/);
});

test('managed paths reject symlinks and allow safe missing destinations', async () => {
    await assert.rejects(resolvePathWithinRoot(tempRoot, 'outside-link/secret'), /Symbolic links/);
    const result = await resolvePathWithinRoot(tempRoot, 'nested/new/file.txt', { allowMissing: true });
    assert.equal(result, path.join(tempRoot, 'nested/new/file.txt'));
});

test('instance serialization redacts secrets from read-only users', () => {
    const user = { id: 'reader', role: 'user' };
    const instance = {
        id: 'instance-1',
        name: 'demo',
        type: 'docker',
        command: 'start',
        cwd: '/secret/path',
        env: { API_KEY: 'secret' },
        dockerConfig: { image: 'demo:latest', volumes: ['/:/host'] },
        permissions: { reader: { terminal: 'read-only', fileManagement: false } }
    };

    const serialized = serializeInstance(instance, user, 'stopped');
    assert.equal(serialized.cwd, undefined);
    assert.equal(serialized.env, undefined);
    assert.deepEqual(serialized.dockerConfig, { image: 'demo:latest' });
    assert.deepEqual(serialized.permissions, { reader: instance.permissions.reader });
});

test('password policy requires a bounded minimum length', () => {
    assert.equal(isStrongEnoughPassword('short'), false);
    assert.equal(isStrongEnoughPassword('long-enough-password'), true);
    assert.equal(isStrongEnoughPassword('x'.repeat(257)), false);
});

test('content security policy preserves direct HTTP access', () => {
    const headers = new Map();
    const middleware = helmet.contentSecurityPolicy({ directives: CONTENT_SECURITY_POLICY_DIRECTIVES });
    const response = {
        setHeader(name, value) {
            headers.set(name.toLowerCase(), value);
        }
    };

    middleware({}, response, error => {
        if (error) throw error;
    });

    const policy = headers.get('content-security-policy');
    assert.equal(policy.includes('upgrade-insecure-requests'), false);
    assert.match(policy, /default-src 'self'/);
});

test('authentication middleware never treats a mounted root path as public', () => {
    let nextCalled = false;
    let statusCode;
    const req = { session: {}, headers: { accept: 'application/json' }, xhr: false, path: '/' };
    const res = {
        status(code) { statusCode = code; return this; },
        json() { return this; },
        redirect() { throw new Error('API requests must not redirect'); }
    };

    isAuthenticated(req, res, () => { nextCalled = true; });
    assert.equal(statusCode, 401);
    assert.equal(nextCalled, false);
});

test('compose container ownership is bound to the instance working directory', () => {
    const instance = { cwd: '/srv/instances/project-a' };
    const matching = { Config: { Labels: { 'com.docker.compose.project.working_dir': '/srv/instances/project-a' } } };
    const foreign = { Config: { Labels: { 'com.docker.compose.project.working_dir': '/srv/instances/project-b' } } };
    assert.equal(containerBelongsToComposeInstance(instance, matching), true);
    assert.equal(containerBelongsToComposeInstance(instance, foreign), false);
    assert.equal(containerBelongsToComposeInstance(instance, { Config: { Labels: {} } }), false);
});

test('shell environment excludes panel secrets and keeps explicit instance variables', () => {
    const originalSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'panel-secret-that-must-not-leak';
    try {
        const environment = buildInstanceEnvironment({ GAME_MODE: 'survival' });
        assert.equal(environment.SESSION_SECRET, undefined);
        assert.equal(environment.GAME_MODE, 'survival');
        assert.equal(environment.HOME, '/workspace');
    } finally {
        if (originalSecret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = originalSecret;
    }
});

test('shell sandbox is enabled by default and can be explicitly disabled', () => {
    const capability = getShellSandboxCapability();
    if (!capability.supported) {
        assert.throws(() => buildShellLaunch(tempRoot, 'pwd'), /required but unavailable/);
        return;
    }
    const sandboxed = buildShellLaunch(tempRoot, 'pwd');
    assert.equal(sandboxed.sandboxed, true);
    assert.equal(sandboxed.file, capability.binary);
    assert.ok(sandboxed.args.includes('/workspace'));
    assert.ok(sandboxed.args.includes('--unshare-user'));
    assert.ok(sandboxed.args.includes('--disable-userns'));
    assert.ok(sandboxed.args.includes('--assert-userns-disabled'));

    const unsandboxed = buildShellLaunch(tempRoot, 'pwd', {}, false);
    assert.equal(unsandboxed.sandboxed, false);
    assert.equal(unsandboxed.cwd, tempRoot);
    assert.throws(() => assertSandboxWorkspaceSafe(path.dirname(DB_PATH)), /sensitive panel data/);
});

test('shell sandbox rejects symbolic-link workspaces', async () => {
    const workspace = path.join(tempRoot, 'real-workspace');
    const workspaceLink = path.join(tempRoot, 'workspace-link');
    await fs.ensureDir(workspace);
    await fs.symlink(workspace, workspaceLink);

    assert.throws(() => assertSandboxWorkspaceSafe(workspaceLink), /symbolic links/);
    if (getShellSandboxCapability().supported) {
        assert.throws(() => buildShellLaunch(workspaceLink, 'pwd'), /symbolic links/);
    }
});

test('shell sandbox prevents nested user namespaces', () => {
    if (!getShellSandboxCapability().supported) return;
    const launch = buildShellLaunch(tempRoot, "unshare --user --map-root-user true >/dev/null 2>&1; test $? -ne 0");
    const result = spawnSync(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('shell sandbox hides host paths outside the bound workspace', async () => {
    if (!getShellSandboxCapability().supported) return;
    const workspace = path.join(tempRoot, 'sandbox-workspace');
    const hostSecret = path.join(tempRoot, 'host-secret');
    await fs.ensureDir(workspace);
    await fs.writeFile(hostSecret, 'secret');
    const launch = buildShellLaunch(workspace, `test ! -e ${JSON.stringify(hostSecret)} && pwd`);
    const result = spawnSync(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '/workspace');
});

test('shell sandbox exposes configured host paths as read-only mounts', async () => {
    const workspace = path.join(tempRoot, 'allowed-path-workspace');
    const allowedPath = path.join(allowedPathRoot, 'external-jdk');
    await fs.ensureDir(workspace);
    await fs.ensureDir(allowedPath);
    await fs.writeFile(path.join(allowedPath, 'release'), 'JAVA_VERSION=21');

    const normalized = normalizeSandboxAllowedPaths([allowedPath, `${allowedPath}/../external-jdk`]);
    assert.deepEqual(normalized, [allowedPath]);
    assert.throws(() => normalizeSandboxAllowedPaths(['relative/path']), /absolute paths/);
    assert.throws(() => normalizeSandboxAllowedPaths([path.dirname(DB_PATH)]), /sensitive host path/);
    assert.throws(() => normalizeSandboxAllowedPaths(['/proc/version']), /reserved sandbox path/);
    assert.throws(() => normalizeSandboxAllowedPaths([path.join(os.tmpdir(), 'host-file')]), /reserved sandbox path/);

    if (!getShellSandboxCapability().supported) return;
    const command = `test -f ${JSON.stringify(path.join(allowedPath, 'release'))} && test ! -w ${JSON.stringify(allowedPath)}`;
    const launch = buildShellLaunch(workspace, command, {}, true, [allowedPath]);
    const result = spawnSync(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});

test('shell sandbox rejects host Unix sockets as read-only mounts', async () => {
    const socketPath = path.join(allowedPathRoot, 'host.sock');
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
    });
    try {
        assert.throws(() => normalizeSandboxAllowedPaths([socketPath]), /regular files or directories/);
    } finally {
        await new Promise(resolve => server.close(resolve));
        await fs.remove(socketPath);
    }
});

test('shell sandbox can preserve the original workspace path', async () => {
    const workspace = path.join(tempRoot, 'original-path-workspace');
    await fs.ensureDir(workspace);
    assert.throws(() => assertSandboxWorkspaceDestinationSafe('/proc/project'), /reserved sandbox path/);

    if (!getShellSandboxCapability().supported) return;
    const launch = buildShellLaunch(workspace, 'pwd; printf "%s\\n" "$HOME"', {}, true, [], true);
    assert.equal(launch.env.HOME, workspace);
    const result = spawnSync(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), [workspace, workspace]);
});

test('unsupported sandbox capability fails closed when sandboxing is required', () => {
    if (process.platform !== 'linux') return;
    const script = `
        const capabilityModule = await import('./src/core/sandboxCapability.js');
        const terminalModule = await import('./src/core/terminalSecurity.js');
        const capability = await capabilityModule.initializeShellSandboxCapability();
        let launchError;
        try {
            terminalModule.buildShellLaunch('/tmp', 'pwd', {}, true);
        } catch (error) {
            launchError = error.message;
        }
        console.log(JSON.stringify({ capability, launchError }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: path.resolve('.'),
        env: { ...process.env, BWRAP_BIN: '/definitely/missing/bwrap' },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.capability.supported, false);
    assert.equal(output.capability.reason, 'binary-not-found');
    assert.match(output.launchError, /required but unavailable/);
});

test('terminal history is capped by lines and bytes', () => {
    const output = Array.from({ length: 2_500 }, (_, index) => `line-${index}`).join('\n');
    const lineLimited = appendTerminalHistory('', output);
    assert.ok(lineLimited.split('\n').length <= MAX_TERMINAL_HISTORY_LINES);
    assert.equal(lineLimited.includes('line-0\n'), false);
    assert.equal(lineLimited.endsWith('line-2499'), true);

    const byteLimited = appendTerminalHistory('', 'x'.repeat(MAX_TERMINAL_HISTORY_BYTES + 1_024));
    assert.ok(Buffer.byteLength(byteLimited) <= MAX_TERMINAL_HISTORY_BYTES);
});

test('terminal WebSocket output is capped at 32KB without splitting UTF-8 characters', () => {
    const output = `${'x'.repeat((32 * 1024) - 2)}你好`;
    const truncated = truncateTerminalOutput(output);

    assert.ok(Buffer.byteLength(truncated) <= 32 * 1024);
    assert.equal(truncated.endsWith('你好'), true);
    assert.equal(truncated.includes('\uFFFD'), false);
});

test('database corruption fails closed and writes remain valid JSON', async () => {
    const databasePath = path.join(tempRoot, 'database.json');
    await fs.writeFile(databasePath, '{invalid-json', { mode: 0o600 });
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        assert.throws(() => readDb(databasePath, []), /JSON/);
    } finally {
        console.error = originalConsoleError;
    }

    writeDb(databasePath, [{ id: 'user-1' }]);
    assert.deepEqual(readDb(databasePath, []), [{ id: 'user-1' }]);
    const mode = (await fs.stat(databasePath)).mode & 0o777;
    assert.equal(mode, 0o600);
});

test('WebDAV destinations are restricted to the current instance', () => {
    const request = {
        method: 'MOVE',
        protocol: 'https',
        baseUrl: '/api/dav',
        params: { instanceId: 'instance-1' },
        headers: { destination: 'https://panel.example/api/dav/instance-1/nested/file.txt' },
        get: () => 'panel.example'
    };
    assert.equal(getWebDavRelativeDestination(request), 'nested/file.txt');

    request.headers.destination = 'https://panel.example/api/dav/instance-2/file.txt';
    assert.throws(() => getWebDavRelativeDestination(request), /same instance/);
    request.headers.destination = 'https://evil.example/api/dav/instance-1/file.txt';
    assert.throws(() => getWebDavRelativeDestination(request), /origin/);
    request.headers.destination = 'https://panel.example/api/dav/instance-1/%2e%2e/escape';
    assert.throws(() => getWebDavRelativeDestination(request), /same instance/);
});
