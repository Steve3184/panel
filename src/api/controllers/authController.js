import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { readDb, writeDb } from '../../data/db.js';
import { USERS_DB_PATH, SALT_ROUNDS } from '../../config.js';
import i18n from '../../utils/i18n.js';

export const setupAdmin = (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    if (users.length > 0) {
        return res.status(403).json({ message: 'server.setup_already_completed' });
    }
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'server.username_password_required' });
    }
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
    const adminUser = { id: uuidv4(), username, passwordHash, role: 'admin' };
    writeDb(USERS_DB_PATH, [adminUser]);
    res.status(201).json({ message: 'server.ok' });
};

export const login = (req, res) => {
    const { username, password } = req.body;
    const users = readDb(USERS_DB_PATH, []);
    const user = users.find(u => u.username === username);
    if (user && bcrypt.compareSync(password, user.passwordHash)) {
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ message: 'server.ok' });
    } else {
        res.status(401).json({ message: 'server.invalid_credentials' });
    }
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
