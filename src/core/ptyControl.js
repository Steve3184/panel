import fs from 'fs/promises';

const DEFAULT_SANDBOX_CHILD_RETRIES = 10;
const DEFAULT_SANDBOX_CHILD_RETRY_DELAY_MS = 10;

function wait(delayMs) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

function parseProcessStat(stat) {
    const commandEnd = stat.lastIndexOf(')');
    if (commandEnd === -1) return null;
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
    if (fields.length < 3) return null;
    const parentPid = Number(fields[1]);
    const processGroup = Number(fields[2]);
    if (!Number.isInteger(parentPid) || !Number.isInteger(processGroup)) return null;
    return { parentPid, processGroup };
}

async function getDirectChildProcessGroup(parentPid, procRoot) {
    const childrenPath = `${procRoot}/${parentPid}/task/${parentPid}/children`;
    const children = (await fs.readFile(childrenPath, 'utf8'))
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    for (const value of children) {
        const childPid = Number(value);
        if (!Number.isInteger(childPid) || childPid <= 0) continue;

        const stat = parseProcessStat(await fs.readFile(`${procRoot}/${childPid}/stat`, 'utf8'));
        if (stat?.parentPid === parentPid && stat.processGroup > 0) {
            return stat.processGroup;
        }
    }
    return null;
}

export async function findSandboxProcessGroup(ptyPid, options = {}) {
    const procRoot = options.procRoot || '/proc';
    const retries = options.retries ?? DEFAULT_SANDBOX_CHILD_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_SANDBOX_CHILD_RETRY_DELAY_MS;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const processGroup = await getDirectChildProcessGroup(ptyPid, procRoot);
            if (processGroup && processGroup !== ptyPid) return processGroup;
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
        }
        if (attempt < retries - 1) await wait(retryDelayMs);
    }
    return null;
}

export async function interruptPty(terminal, sandboxed = false, options = {}) {
    if (!sandboxed || process.platform !== 'linux') {
        terminal.write('\x03');
        return;
    }

    const sandboxProcessGroup = await findSandboxProcessGroup(terminal.pid, options);
    if (!sandboxProcessGroup) {
        throw new Error('Unable to find the sandbox process group for Ctrl+C.');
    }

    process.kill(-sandboxProcessGroup, 'SIGINT');
}
