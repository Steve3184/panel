import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { DB_PATH } from '../config.js';

const SESSION_SECRET_PATH = path.join(DB_PATH, 'session-secret');

export const CONTENT_SECURITY_POLICY_DIRECTIVES = {
    defaultSrc: ["'self'"],
    // Monaco Editor requires eval() for its worker compilation
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    // Bootstrap and Monaco inject inline styles
    styleSrc: ["'self'", "'unsafe-inline'"],
    // data: for base64 logos/backgrounds, blob: for Monaco worker URLs
    imgSrc: ["'self'", 'data:', 'blob:'],
    // WebSocket connections back to this same server
    connectSrc: ["'self'", 'ws:', 'wss:'],
    fontSrc: ["'self'", 'data:'],
    // Monaco workers are loaded as blob: URLs
    workerSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    // Prevent the panel from being embedded in iframes on other origins
    frameAncestors: ["'none'"],
    // Direct IP deployments must remain accessible over plain HTTP.
    upgradeInsecureRequests: null,
};

export async function loadSessionSecret() {
    const configuredSecret = process.env.SESSION_SECRET;
    if (configuredSecret) {
        if (Buffer.byteLength(configuredSecret) < 32) {
            throw new Error('SESSION_SECRET must contain at least 32 bytes.');
        }
        return configuredSecret;
    }

    await fs.ensureDir(DB_PATH, 0o700);
    try {
        const existingSecret = (await fs.readFile(SESSION_SECRET_PATH, 'utf8')).trim();
        if (existingSecret.length >= 64) {
            await fs.chmod(SESSION_SECRET_PATH, 0o600);
            return existingSecret;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const generatedSecret = crypto.randomBytes(48).toString('hex');
    await fs.writeFile(SESSION_SECRET_PATH, generatedSecret, { mode: 0o600, flag: 'wx' });
    return generatedSecret;
}

export async function hardenDataPermissions(directories) {
    for (const directory of directories) {
        await fs.ensureDir(directory, 0o700);
        await fs.chmod(directory, 0o700);
        const entries = await fs.readdir(directory, { withFileTypes: true });
        await Promise.all(entries.map(async entry => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isFile()) await fs.chmod(entryPath, 0o600);
        }));
    }
}

// Safe HTTP methods that carry no state-changing side effects.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isRequestOriginAllowed(req) {
    const origin = req.headers.origin;

    // For safe (read-only) methods an absent Origin is fine — browsers omit it
    // on same-origin navigations and many legitimate GET requests.
    // For state-changing methods (POST / PUT / DELETE / PATCH) we require the
    // Origin header so that HTML-form CSRF attacks without an Origin cannot
    // reach the API.
    if (!origin) {
        return SAFE_METHODS.has(req.method.toUpperCase());
    }

    try {
        const originUrl = new URL(origin);
        return originUrl.host === req.get('host') && originUrl.protocol === `${req.protocol}:`;
    } catch {
        return false;
    }
}

export function validateRequestOrigin(req, res, next) {
    if (isRequestOriginAllowed(req)) return next();
    return res.status(403).json({ message: 'server.invalid_request_origin' });
}

export function isStrongEnoughPassword(password) {
    return typeof password === 'string' && password.length >= 12 && password.length <= 256;
}
