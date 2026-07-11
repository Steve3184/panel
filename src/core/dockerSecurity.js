import path from 'path';
import fs from 'fs';

function canonicalizePath(value) {
    try {
        return fs.realpathSync.native(value);
    } catch {
        return path.resolve(value);
    }
}

/**
 * Derive the docker compose project name from the working directory, matching
 * what `docker compose` does by default: lowercase basename, hyphens/underscores
 * allowed, other characters replaced with hyphens.
 */
export function expectedComposeProjectName(cwd) {
    return path.basename(cwd)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '') || 'project';
}

export function containerBelongsToComposeInstance(instanceConfig, inspectData) {
    const configuredCwd = instanceConfig?.cwd;
    const labels = inspectData?.Config?.Labels ?? {};
    const composeWorkingDir = labels['com.docker.compose.project.working_dir'];
    if (!configuredCwd || !composeWorkingDir) return false;
    if (canonicalizePath(configuredCwd) !== canonicalizePath(composeWorkingDir)) return false;

    // Also verify the project name label, if present, matches the expected name.
    // This prevents orphan containers from a previous compose configuration that
    // share the same working directory from being treated as current-project containers.
    const containerProject = labels['com.docker.compose.project'];
    if (containerProject) {
        return containerProject === expectedComposeProjectName(configuredCwd);
    }
    return true;
}
