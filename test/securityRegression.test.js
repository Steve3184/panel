import assert from 'node:assert/strict';
import { after, afterEach, mock, test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcrypt';
import pty from 'node-pty';
import Docker from 'dockerode';

// Set the data root before importing application modules. No existing panel
// database, sessions, Docker daemon or actual terminal is used by these tests.
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-regression-'));
process.env.PANEL_DATA_DIR = path.join(temporaryRoot, 'data');
const { setupAdmin } = await import('../src/api/controllers/authController.js');
const { startInstance, activeInstances, switchDockerComposeContainer } = await import('../src/core/instanceManager.js');
const { panelSettingsReady } = await import('../src/api/controllers/panelSettingsController.js');
const { readDb, writeDb } = await import('../src/data/db.js');
const { USERS_DB_PATH, INSTANCES_DB_PATH } = await import('../src/config.js');
await panelSettingsReady;

afterEach(() => {
    mock.restoreAll();
    activeInstances.clear();
});
after(() => fs.remove(temporaryRoot));

function response() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('concurrent initial setup cannot replace the first completed admin account', async () => {
    writeDb(USERS_DB_PATH, []);
    const pendingHashes = [];
    mock.method(bcrypt, 'hash', () => new Promise(resolve => pendingHashes.push(resolve)));
    const events = new EventEmitter();
    let addedUsers = 0;
    events.on('userAdded', () => addedUsers++);
    const request = username => ({
        body: { username, password: 'valid-test-password' },
        app: { get: () => events }
    });
    const firstResponse = response();
    const secondResponse = response();
    const firstSetup = setupAdmin(request('first-request'), firstResponse);
    const secondSetup = setupAdmin(request('first-completion'), secondResponse);
    assert.equal(pendingHashes.length, 2);

    pendingHashes[1]('second-request-hash');
    await secondSetup;
    pendingHashes[0]('first-request-hash');
    await firstSetup;

    assert.equal(secondResponse.statusCode, 201);
    assert.equal(firstResponse.statusCode, 403);
    assert.equal(firstResponse.body.message, 'server.setup_already_completed');
    const users = readDb(USERS_DB_PATH);
    assert.equal(users.length, 1);
    assert.equal(users[0].username, 'first-completion');
    assert.equal(users[0].passwordHash, 'second-request-hash');
    assert.equal(addedUsers, 1);
});

function socket(user, instanceId) {
    return {
        user: { ...user },
        readyState: 1,
        subscribedInstanceId: instanceId,
        messages: [],
        send(data) { this.messages.push(JSON.parse(data)); },
        close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
    };
}

async function runningTerminal(role = 'user') {
    const reader = { id: 'reader', username: 'reader', role, sessionVersion: 0 };
    const keeper = { id: 'keeper', username: 'keeper', role: 'user', sessionVersion: 0 };
    const instance = {
        id: 'terminal-regression',
        name: 'isolated terminal',
        type: 'shell',
        command: 'unused mocked command',
        cwd: path.join(temporaryRoot, 'workspace'),
        sandboxEnabled: false,
        permissions: {
            reader: { terminal: 'read-only' },
            keeper: { terminal: 'read-only' }
        }
    };
    writeDb(USERS_DB_PATH, [reader, keeper]);
    writeDb(INSTANCES_DB_PATH, [instance]);
    const terminal = new EventEmitter();
    mock.method(pty, 'spawn', () => terminal);
    await startInstance(instance);
    const session = activeInstances.get(instance.id);
    const readerSocket = socket(reader, instance.id);
    const keeperSocket = socket(keeper, instance.id);
    session.listeners.add(readerSocket);
    session.listeners.add(keeperSocket);
    terminal.emit('data', 'before revocation');
    assert.equal(readerSocket.messages.length, 1);
    assert.equal(keeperSocket.messages.length, 1);
    return { reader, keeper, instance, terminal, session, readerSocket, keeperSocket };
}

for (const change of ['permission', 'password', 'deletion', 'admin-demotion']) {
    test(`terminal output stops after ${change} revocation without another client message`, async () => {
        const state = await runningTerminal(change === 'admin-demotion' ? 'admin' : 'user');
        const { reader, keeper, instance, terminal, session, readerSocket, keeperSocket } = state;
        if (change === 'permission' || change === 'admin-demotion') {
            delete instance.permissions.reader;
            writeDb(INSTANCES_DB_PATH, [instance]);
        }
        if (change === 'password') {
            writeDb(USERS_DB_PATH, [{ ...reader, sessionVersion: 1 }, keeper]);
        } else if (change === 'deletion') {
            writeDb(USERS_DB_PATH, [keeper]);
        } else if (change === 'admin-demotion') {
            writeDb(USERS_DB_PATH, [{ ...reader, role: 'user' }, keeper]);
        }

        terminal.emit('data', 'secret after revocation');
        assert.equal(readerSocket.messages.length, 1, 'revoked subscriber received terminal output');
        assert.equal(session.listeners.has(readerSocket), false);
        assert.equal(readerSocket.subscribedInstanceId, null);
        assert.equal(keeperSocket.messages.length, 2, 'authorized subscriber must keep receiving output');
        assert.equal(keeperSocket.messages[1].data, 'secret after revocation');
        if (change === 'password' || change === 'deletion') {
            assert.equal(readerSocket.closed.code, 1008);
        }
    });
}

test('compose switches and their replacement output streams enforce current subscriptions', async () => {
    const { reader, keeper, instance, terminal, session, readerSocket, keeperSocket } = await runningTerminal();
    instance.type = 'docker_compose';
    delete instance.permissions.reader;
    writeDb(INSTANCES_DB_PATH, [instance]);
    const replacementStream = new PassThrough();
    mock.method(Docker.prototype, 'getContainer', () => ({
        id: 'mock-container',
        inspect: async () => ({ Config: {
            Tty: true,
            Labels: { 'com.docker.compose.project.working_dir': instance.cwd }
        } }),
        attach: async () => replacementStream
    }));
    try {
        await switchDockerComposeContainer(instance.id, 'mock-container');
        assert.equal(readerSocket.messages.length, 1, 'revoked reader received the container switch notice');
        assert.equal(session.listeners.has(readerSocket), false);
        assert.equal(keeperSocket.messages.length, 2);
        assert.match(keeperSocket.messages[1].data, /Switched to container/);
        replacementStream.write('allowed container output');
        assert.equal(keeperSocket.messages.length, 3);
        assert.equal(keeperSocket.messages[2].data, 'allowed container output');

        writeDb(USERS_DB_PATH, [reader, { ...keeper, sessionVersion: 1 }]);
        replacementStream.write('container output after password reset');
        assert.equal(keeperSocket.messages.length, 3);
        assert.equal(session.listeners.has(keeperSocket), false);
        assert.equal(keeperSocket.closed.code, 1008);
    } finally {
        replacementStream.destroy();
        terminal.removeAllListeners();
    }
});
