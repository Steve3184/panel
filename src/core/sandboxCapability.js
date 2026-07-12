import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let capability = {
    checked: process.platform !== 'linux',
    supported: false,
    platform: process.platform,
    source: null,
    binary: null,
    version: null,
    reason: process.platform === 'linux' ? 'not-checked' : 'unsupported-platform'
};
let initializationPromise;

export function buildBubblewrapArguments(workspace, command, shell = '/bin/bash', allowedPaths = [], workspaceDestination = '/workspace') {
    const allowedPathArguments = allowedPaths.flatMap(allowedPath => [
        '--ro-bind', allowedPath, allowedPath
    ]);

    return [
        '--die-with-parent',
        '--new-session',
        '--unshare-all',
        '--share-net',
        '--proc', '/proc',
        '--dev', '/dev',
        '--tmpfs', '/tmp',
        '--ro-bind', '/usr', '/usr',
        '--ro-bind-try', '/bin', '/bin',
        '--ro-bind-try', '/lib', '/lib',
        '--ro-bind-try', '/lib64', '/lib64',
        '--dir', '/etc',
        '--ro-bind-try', '/etc/passwd', '/etc/passwd',
        '--ro-bind-try', '/etc/group', '/etc/group',
        '--ro-bind-try', '/etc/nsswitch.conf', '/etc/nsswitch.conf',
        '--ro-bind-try', '/etc/hosts', '/etc/hosts',
        '--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf',
        '--ro-bind-try', '/etc/localtime', '/etc/localtime',
        '--ro-bind-try', '/etc/ssl', '/etc/ssl',
        '--ro-bind-try', '/etc/ca-certificates', '/etc/ca-certificates',
        ...allowedPathArguments,
        '--bind', workspace, workspaceDestination,
        '--chdir', workspaceDestination,
        '--hostname', 'panel-instance',
        '--cap-drop', 'ALL',
        '--', shell, '-c', command
    ];
}

function getCandidates() {
    if (process.env.BWRAP_BIN) {
        return [{ binary: process.env.BWRAP_BIN, source: 'configured' }];
    }
    return [
        { binary: path.join(projectRoot, 'bin', 'bwrap'), source: 'bundled' },
        { binary: '/usr/bin/bwrap', source: 'system' },
        { binary: '/usr/local/bin/bwrap', source: 'system' },
        { binary: '/bin/bwrap', source: 'system' }
    ];
}

async function probeCandidate(candidate) {
    if (!path.isAbsolute(candidate.binary) || !await fs.pathExists(candidate.binary)) {
        throw new Error('binary-not-found');
    }
    try {
        await fs.access(candidate.binary, fs.constants.X_OK);
    } catch (error) {
        if (candidate.source !== 'bundled') throw error;
        await fs.chmod(candidate.binary, 0o755);
        await fs.access(candidate.binary, fs.constants.X_OK);
    }

    const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-bwrap-probe-'));
    const workspace = path.join(probeRoot, 'workspace');
    const hiddenFile = path.join(probeRoot, 'host-secret');
    try {
        await fs.ensureDir(workspace);
        await fs.writeFile(path.join(workspace, 'visible'), 'visible');
        await fs.writeFile(hiddenFile, 'secret');
        const command = `test -f /workspace/visible && test ! -e ${JSON.stringify(hiddenFile)}`;
        await execFileAsync(candidate.binary, buildBubblewrapArguments(workspace, command, '/bin/sh'), {
            timeout: 10_000,
            maxBuffer: 64 * 1024,
            env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
        });
        const { stdout } = await execFileAsync(candidate.binary, ['--version'], { timeout: 5_000 });
        return stdout.trim();
    } finally {
        await fs.remove(probeRoot);
    }
}

export async function initializeShellSandboxCapability() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        if (process.platform !== 'linux') return capability;

        let probeFailed = false;
        for (const candidate of getCandidates()) {
            try {
                const version = await probeCandidate(candidate);
                capability = {
                    checked: true,
                    supported: true,
                    platform: process.platform,
                    source: candidate.source,
                    binary: candidate.binary,
                    version,
                    reason: null
                };
                return capability;
            } catch (error) {
                if (error.message !== 'binary-not-found') probeFailed = true;
            }
        }

        capability = {
            checked: true,
            supported: false,
            platform: process.platform,
            source: null,
            binary: null,
            version: null,
            reason: probeFailed ? 'probe-failed' : 'binary-not-found'
        };
        return capability;
    })();
    return initializationPromise;
}

export function getShellSandboxCapability() {
    return { ...capability };
}
