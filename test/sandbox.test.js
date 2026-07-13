import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
    buildBubblewrapArguments,
    getShellSandboxCapability,
    initializeShellSandboxCapability
} from '../src/core/sandboxCapability.js';
import {
    buildInstanceEnvironment,
    buildSandboxLauncherEnvironment,
    buildShellLaunch,
    normalizeSandboxAllowedPaths
} from '../src/core/terminalSecurity.js';
import { findSandboxProcessGroup, interruptPty } from '../src/core/ptyControl.js';

let tempRoot;

function findOption(args, option, firstValue) {
    for (let index = 0; index < args.length; index++) {
        if (args[index] === option && (firstValue === undefined || args[index + 1] === firstValue)) return index;
    }
    return -1;
}

before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.homedir(), '.panel-sandbox-test-'));
    await initializeShellSandboxCapability();
});

after(async () => {
    await fs.remove(tempRoot);
});

test('bubblewrap arguments clear the launcher environment and inject the command environment', () => {
    const args = buildBubblewrapArguments(
        '/host/workspace',
        'printf test',
        '/bin/sh',
        [{ source: '/real/toolchain', destination: '/opt/toolchain' }],
        '/workspace',
        { CUSTOM_VALUE: 'inside', LD_LIBRARY_PATH: '/workspace/lib' }
    );

    const clearEnvIndex = args.indexOf('--clearenv');
    const customEnvIndex = findOption(args, '--setenv', 'CUSTOM_VALUE');
    const loaderEnvIndex = findOption(args, '--setenv', 'LD_LIBRARY_PATH');
    const mountIndex = findOption(args, '--ro-bind', '/real/toolchain');
    assert.ok(clearEnvIndex > 0);
    assert.ok(customEnvIndex > clearEnvIndex);
    assert.deepEqual(args.slice(customEnvIndex, customEnvIndex + 3), ['--setenv', 'CUSTOM_VALUE', 'inside']);
    assert.deepEqual(args.slice(loaderEnvIndex, loaderEnvIndex + 3), ['--setenv', 'LD_LIBRARY_PATH', '/workspace/lib']);
    assert.deepEqual(args.slice(mountIndex, mountIndex + 3), ['--ro-bind', '/real/toolchain', '/opt/toolchain']);
});

test('sandbox launch keeps instance variables away from the host-side bubblewrap process', async () => {
    if (!getShellSandboxCapability().supported) return;

    const workspace = path.join(tempRoot, 'environment-workspace');
    await fs.ensureDir(workspace);
    const launch = buildShellLaunch(
        workspace,
        `printf '%s|%s|%s|%s' "$CUSTOM_VALUE" "$LD_LIBRARY_PATH" "$HOME" "$PWD"`,
        { CUSTOM_VALUE: 'inside', LD_LIBRARY_PATH: '/workspace/lib' }
    );

    assert.equal(launch.env.CUSTOM_VALUE, undefined);
    assert.equal(launch.env.LD_LIBRARY_PATH, undefined);
    assert.ok(findOption(launch.args, '--setenv', 'CUSTOM_VALUE') > 0);
    assert.ok(findOption(launch.args, '--setenv', 'LD_LIBRARY_PATH') > 0);

    const result = spawnSync(launch.file, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'inside|/workspace/lib|/workspace|/workspace');
});

test('shell environment rejects null bytes before spawning bubblewrap', () => {
    assert.throws(
        () => buildInstanceEnvironment({ INVALID_VALUE: 'before\0after' }),
        /must not contain null bytes/
    );
});

test('bubblewrap launcher environment excludes host loader and panel secret variables', () => {
    const originalLoaderPath = process.env.LD_LIBRARY_PATH;
    const originalSessionSecret = process.env.SESSION_SECRET;
    process.env.LD_LIBRARY_PATH = '/host/loader-path';
    process.env.SESSION_SECRET = 'host-panel-secret';
    try {
        const environment = buildSandboxLauncherEnvironment();
        assert.equal(environment.LD_LIBRARY_PATH, undefined);
        assert.equal(environment.SESSION_SECRET, undefined);
    } finally {
        if (originalLoaderPath === undefined) delete process.env.LD_LIBRARY_PATH;
        else process.env.LD_LIBRARY_PATH = originalLoaderPath;
        if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = originalSessionSecret;
    }
});

test('read-only mounts require existing regular files or directories', async () => {
    const missingPath = path.join(tempRoot, 'missing-path');
    assert.throws(() => normalizeSandboxAllowedPaths([missingPath]), /must exist/);

    if (process.platform === 'win32') return;
    const fifoPath = path.join(tempRoot, 'host.fifo');
    const fifoResult = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    assert.equal(fifoResult.status, 0, fifoResult.stderr);
    assert.throws(() => normalizeSandboxAllowedPaths([fifoPath]), /regular files or directories/);
});

test('read-only mounts enforce the configured path count limit before deduplication', async () => {
    const allowedPath = path.join(tempRoot, 'path-count-target');
    await fs.ensureDir(allowedPath);
    assert.throws(() => normalizeSandboxAllowedPaths(Array(33).fill(allowedPath)), /at most 32 entries/);
});

test('read-only mount symlinks use a canonical source and preserve their configured destination', async () => {
    if (!getShellSandboxCapability().supported) return;

    const workspace = path.join(tempRoot, 'symlink-mount-workspace');
    const target = path.join(tempRoot, 'toolchain-target');
    const alias = path.join(tempRoot, 'toolchain-current');
    await fs.ensureDir(workspace);
    await fs.ensureDir(target);
    await fs.writeFile(path.join(target, 'release'), 'VERSION=1');
    await fs.symlink(target, alias);

    const launch = buildShellLaunch(workspace, `cat ${JSON.stringify(path.join(alias, 'release'))}`, {}, true, [alias]);
    const mountIndex = findOption(launch.args, '--ro-bind', target);
    assert.ok(mountIndex > 0);
    assert.deepEqual(launch.args.slice(mountIndex, mountIndex + 3), ['--ro-bind', target, alias]);

    const result = spawnSync(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'VERSION=1');
});

test('read-only mounts cannot overlap the writable workspace', async () => {
    if (!getShellSandboxCapability().supported) return;

    const workspace = path.join(tempRoot, 'overlap-workspace');
    const nestedPath = path.join(workspace, 'nested');
    await fs.ensureDir(nestedPath);

    assert.throws(
        () => buildShellLaunch(workspace, 'true', {}, true, [nestedPath]),
        /overlaps the writable workspace/
    );
    assert.throws(
        () => buildShellLaunch(workspace, 'true', {}, true, [workspace], true),
        /overlaps the writable workspace/
    );
});

test('allowed-path symlinks cannot bypass reserved path checks', async () => {
    const procAlias = path.join(tempRoot, 'proc-alias');
    await fs.symlink('/proc', procAlias);
    assert.throws(() => normalizeSandboxAllowedPaths([procAlias]), /reserved sandbox path/);
});

test('symlinked panel data roots remain protected by canonical path checks', async () => {
    const realDataRoot = path.join(tempRoot, 'real-panel-data');
    const linkedDataRoot = path.join(tempRoot, 'linked-panel-data');
    const workspaceInsideDataRoot = path.join(realDataRoot, 'db', 'unsafe');
    await fs.ensureDir(workspaceInsideDataRoot);
    await fs.symlink(realDataRoot, linkedDataRoot);

    const script = `
        const terminalModule = await import('./src/core/terminalSecurity.js');
        let error;
        try {
            terminalModule.assertSandboxWorkspaceSafe(${JSON.stringify(workspaceInsideDataRoot)});
        } catch (caught) {
            error = caught.message;
        }
        console.log(JSON.stringify({ error }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: path.resolve('.'),
        env: { ...process.env, PANEL_DATA_DIR: linkedDataRoot },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.match(output.error, /sensitive panel data/);
});

test('capability probe rejects an executable that exits successfully without running the sandbox check', () => {
    if (process.platform !== 'linux') return;
    const script = `
        const capabilityModule = await import('./src/core/sandboxCapability.js');
        console.log(JSON.stringify(await capabilityModule.initializeShellSandboxCapability()));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: path.resolve('.'),
        env: { ...process.env, BWRAP_BIN: '/bin/true' },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const capability = JSON.parse(result.stdout.trim());
    assert.equal(capability.supported, false);
    assert.equal(capability.reason, 'probe-failed');
});

test('capability probe rejects invalid bubblewrap version output', async () => {
    const capability = getShellSandboxCapability();
    if (!capability.supported) return;

    const wrapperPath = path.join(tempRoot, 'bwrap-invalid-version');
    const quotedBinary = `'${capability.binary.replaceAll("'", "'\\''")}'`;
    await fs.writeFile(wrapperPath, `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo not-bubblewrap\n  exit 0\nfi\nexec ${quotedBinary} "$@"\n`, { mode: 0o700 });
    const script = `
        const capabilityModule = await import('./src/core/sandboxCapability.js');
        console.log(JSON.stringify(await capabilityModule.initializeShellSandboxCapability()));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: path.resolve('.'),
        env: { ...process.env, BWRAP_BIN: wrapperPath },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const wrapperCapability = JSON.parse(result.stdout.trim());
    assert.equal(wrapperCapability.supported, false);
    assert.equal(wrapperCapability.reason, 'probe-failed');
});

test('sandbox process-group discovery retries until bubblewrap creates its child', async () => {
    const procRoot = path.join(tempRoot, 'fake-proc');
    const parentPid = 4200;
    const childPid = 4201;
    const processGroup = 4300;
    const childrenPath = path.join(procRoot, String(parentPid), 'task', String(parentPid), 'children');
    const statPath = path.join(procRoot, String(childPid), 'stat');
    await fs.outputFile(childrenPath, '');

    const populateProc = setTimeout(() => {
        fs.outputFileSync(statPath, `${childPid} (bwrap (sandbox)) S ${parentPid} ${processGroup} ${processGroup} 0 0`);
        fs.writeFileSync(childrenPath, String(childPid));
    }, 15);

    try {
        const result = await findSandboxProcessGroup(parentPid, {
            procRoot,
            retries: 10,
            retryDelayMs: 5
        });
        assert.equal(result, processGroup);
    } finally {
        clearTimeout(populateProc);
    }
});

test('non-sandboxed PTY interrupt writes the Ctrl+C control byte', async () => {
    const writes = [];
    await interruptPty({ write: value => writes.push(value) }, false);
    assert.deepEqual(writes, ['\x03']);
});

test('sandboxed PTY interrupt does not fall back to Ctrl+C when the process group is missing', async () => {
    if (process.platform !== 'linux') return;
    const writes = [];
    await assert.rejects(
        interruptPty({ pid: 999999, write: value => writes.push(value) }, true, {
            procRoot: path.join(tempRoot, 'missing-proc'),
            retries: 1,
            retryDelayMs: 0
        }),
        /Unable to find the sandbox process group/
    );
    assert.deepEqual(writes, []);
});
