import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb } from '../../data/db.js';
import { USERS_DB_PATH, SALT_ROUNDS } from '../../config.js';
import { isStrongEnoughPassword } from '../../utils/security.js';
import { getShellSandboxCapability } from '../../core/sandboxCapability.js';

export const setupAdmin = (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    if (users.length > 0) {
        return res.status(403).json({ message: 'server.setup_already_completed' });
    }
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'server.username_password_required' });
    }
    if (!isStrongEnoughPassword(password)) {
        return res.status(400).json({ message: 'server.password_requirements' });
    }
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
    const adminUser = { id: uuidv4(), username, passwordHash, role: 'admin', sessionVersion: 0 };
    writeDb(USERS_DB_PATH, [adminUser]);
    req.app.get('userEvents')?.emit('userAdded');
    res.status(201).json({ message: 'server.ok' });
};

export const login = async (req, res) => {
    const { username, password } = req.body;
    const users = readDb(USERS_DB_PATH, []);
    const user = users.find(u => u.username === username);
    if (!user || typeof password !== 'string' || !await bcrypt.compare(password, user.passwordHash)) {
        return res.status(401).json({ message: 'server.invalid_credentials' });
    }

    req.session.regenerate(error => {
        if (error) return res.status(500).json({ message: 'server.internal_server_error' });
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            sessionVersion: user.sessionVersion || 0
        };
        req.session.save(saveError => {
            if (saveError) return res.status(500).json({ message: 'server.internal_server_error' });
            res.json({ message: 'server.ok' });
        });
    });
};

export const logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to log out.' });
        }
        res.json({ message: 'server.ok' });
    });
};

export const getSession = (req, res) => {
    res.json({ user: req.session.user || null });
};

export const checkAdminExists = (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    res.json({ adminExists: users.some(u => u.role === 'admin') });
};

export const getCapabilities = (req, res) => {
    const sandbox = getShellSandboxCapability();
    res.json({
        platform: process.platform,
        shellSandbox: {
            supported: sandbox.supported,
            source: sandbox.source,
            version: sandbox.version,
            reason: sandbox.reason
        }
    });
};
