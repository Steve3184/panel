import path from 'path';
import fs from 'fs';

function canonicalizePath(value) {
    try {
        return fs.realpathSync.native(value);
    } catch {
        return path.resolve(value);
    }
}

export function containerBelongsToComposeInstance(instanceConfig, inspectData) {
    const configuredCwd = instanceConfig?.cwd;
    const composeWorkingDir = inspectData?.Config?.Labels?.['com.docker.compose.project.working_dir'];
    if (!configuredCwd || !composeWorkingDir) return false;
    return canonicalizePath(configuredCwd) === canonicalizePath(composeWorkingDir);
}
