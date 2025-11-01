import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb } from '../../data/db.js';
import { USERS_DB_PATH, INSTANCES_DB_PATH, SALT_ROUNDS } from '../../config.js';
import i18n from '../../utils/i18n.js';

export const getAllUsers = (req, res) => {
    const users = readDb(USERS_DB_PATH, []);
    res.json(users.map(({ passwordHash, ...user }) => user)); // 不返回密码哈希
};

export const createUser = async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'server.username_password_required' });
    }
    const users = readDb(USERS_DB_PATH, []);
    if (users.some(u => u.username === username)) {
        return res.status(409).json({ message: 'server.username_already_exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = { id: uuidv4(), username, passwordHash, role: role || 'user' };
    users.push(newUser);
    writeDb(USERS_DB_PATH, users);
    res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
};

export const updateUser = async (req, res) => {
    const { id } = req.params;
    const { username, password, role } = req.body;
    let users = readDb(USERS_DB_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) return res.status(404).json({ message: 'server.user_not_found' });

    if (id === req.session.user.id && role && role !== 'admin') {
        return res.status(403).json({ message: 'server.cannot_demote_admin_account' });
    }

    const updatedUser = { ...users[userIndex] };
    if (username) updatedUser.username = username;
    if (password) updatedUser.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    if (role) updatedUser.role = role;

    users[userIndex] = updatedUser;
    writeDb(USERS_DB_PATH, users);
    res.json({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role });
};

export const updateUserPassword = async (req, res) => {
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ message: 'server.new_password_required' });

    let users = readDb(USERS_DB_PATH, []);
    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) return res.status(404).json({ message: 'server.user_not_found' });

    const targetUser = users[userIndex];
    if (req.session.user.id === id) {
        if (!oldPassword || !await bcrypt.compare(oldPassword, targetUser.passwordHash)) {
            return res.status(401).json({ message: 'server.incorrect_old_password' });
        }
    } else if (req.session.user.role !== 'admin') {
        return res.status(403).json({ message: 'server.no_perms' });
    }

    targetUser.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    writeDb(USERS_DB_PATH, users);
    res.json({ message: 'server.password_updated_successfully' });
};

export const deleteUser = (req, res) => {
    const { id } = req.params;
    if (id === req.session.user.id) {
        return res.status(403).json({ message: 'server.cannot_delete_admin_account' });
    }
    
    let users = readDb(USERS_DB_PATH, []);
    const initialLength = users.length;
    users = users.filter(u => u.id !== id);
    if (users.length === initialLength) {
        return res.status(404).json({ message: 'server.user_not_found' });
    }
    writeDb(USERS_DB_PATH, users);

    // 从所有实例中移除该用户的权限
    let instances = readDb(INSTANCES_DB_PATH, []);
    instances.forEach(instance => {
        if (instance.permissions?.[id]) {
            delete instance.permissions[id];
        }
    });
    writeDb(INSTANCES_DB_PATH, instances);

    res.status(204).send();
};