import fs from 'fs/promises';

const SANDBOX_CHILD_RETRIES = 10;
const SANDBOX_CHILD_RETRY_DELAY_MS = 10;

function wait(delayMs) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function getDirectChildProcessGroup(parentPid) {
    const childrenPath = `/proc/${parentPid}/task/${parentPid}/children`;
    const children = (await fs.readFile(childrenPath, 'utf8'))
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    for (const value of children) {
        const childPid = Number(value);
        if (!Number.isInteger(childPid) || childPid <= 0) continue;

        const stat = await fs.readFile(`/proc/${childPid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        const childParentPid = Number(fields[1]);
        const childProcessGroup = Number(fields[2]);
        if (childParentPid === parentPid && Number.isInteger(childProcessGroup) && childProcessGroup > 0) {
            return childProcessGroup;
        }
    }
    return null;
}

async function findSandboxProcessGroup(ptyPid) {
    for (let attempt = 0; attempt < SANDBOX_CHILD_RETRIES; attempt++) {
        try {
            const processGroup = await getDirectChildProcessGroup(ptyPid);
            if (processGroup && processGroup !== ptyPid) return processGroup;
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
        }
        if (attempt < SANDBOX_CHILD_RETRIES - 1) await wait(SANDBOX_CHILD_RETRY_DELAY_MS);
    }
    return null;
}

export async function interruptPty(terminal, sandboxed = false) {
    if (!sandboxed || process.platform !== 'linux') {
        terminal.write('\x03');
        return;
    }

    const sandboxProcessGroup = await findSandboxProcessGroup(terminal.pid);
    if (!sandboxProcessGroup) {
        throw new Error('Unable to find the sandbox process group for Ctrl+C.');
    }

    process.kill(-sandboxProcessGroup, 'SIGINT');
}
