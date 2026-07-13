import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';

import { prepareSessionStore } from '../src/utils/security.js';

const temporaryDirectories = new Set();

async function createSessionDirectory() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-session-store-'));
    temporaryDirectories.add(directory);
    return directory;
}

afterEach(async () => {
    await Promise.all([...temporaryDirectories].map(directory => fs.remove(directory)));
    temporaryDirectories.clear();
});

test('session store migration removes legacy plaintext sessions only once', async () => {
    const sessionPath = await createSessionDirectory();
    const sessionSecret = 'a'.repeat(64);
    const legacySessionPath = path.join(sessionPath, 'legacy.json');
    const unrelatedPath = path.join(sessionPath, 'keep.txt');
    await fs.writeJson(legacySessionPath, { cookie: {}, user: { id: 'legacy' } });
    await fs.writeFile(unrelatedPath, 'keep');

    const firstPreparation = await prepareSessionStore(sessionPath, sessionSecret);
    assert.equal(firstPreparation.reset, true);
    assert.equal(firstPreparation.removedSessions, 1);
    assert.equal(await fs.pathExists(legacySessionPath), false);
    assert.equal(await fs.readFile(unrelatedPath, 'utf8'), 'keep');
    assert.equal(path.extname(firstPreparation.metadataPath), '');

    const currentSessionPath = path.join(sessionPath, 'current.json');
    await fs.writeFile(currentSessionPath, 'current-session-placeholder');
    const secondPreparation = await prepareSessionStore(sessionPath, sessionSecret);
    assert.equal(secondPreparation.reset, false);
    assert.equal(secondPreparation.removedSessions, 0);
    assert.equal(await fs.pathExists(currentSessionPath), true);
});

test('session store migration clears sessions when the encryption secret changes', async () => {
    const sessionPath = await createSessionDirectory();
    await prepareSessionStore(sessionPath, 'a'.repeat(64));
    const sessionFile = path.join(sessionPath, 'current.json');
    await fs.writeFile(sessionFile, 'encrypted-session-placeholder');

    const preparation = await prepareSessionStore(sessionPath, 'b'.repeat(64));
    assert.equal(preparation.reset, true);
    assert.equal(preparation.removedSessions, 1);
    assert.equal(await fs.pathExists(sessionFile), false);
});

test('session store migration recovers from invalid metadata', async () => {
    const sessionPath = await createSessionDirectory();
    const initialPreparation = await prepareSessionStore(sessionPath, 'd'.repeat(64));
    const sessionFile = path.join(sessionPath, 'current.json');
    await fs.writeFile(sessionFile, 'legacy-session');
    await fs.writeJson(initialPreparation.metadataPath, null);

    const preparation = await prepareSessionStore(sessionPath, 'd'.repeat(64));
    assert.equal(preparation.reset, true);
    assert.equal(preparation.removedSessions, 1);
    assert.equal(await fs.pathExists(sessionFile), false);
});

test('prepared encrypted session files can be read by session-file-store', async () => {
    const sessionPath = await createSessionDirectory();
    const sessionSecret = 'c'.repeat(64);
    await prepareSessionStore(sessionPath, sessionSecret);

    const FileStore = FileStoreFactory(session);
    const store = new FileStore({
        path: sessionPath,
        secret: sessionSecret,
        reapInterval: -1,
        logFn() {}
    });
    const storedSession = { cookie: { originalMaxAge: 60_000 }, user: { id: 'current' } };
    await new Promise((resolve, reject) => {
        store.set('current', storedSession, error => error ? reject(error) : resolve());
    });
    const restoredSession = await new Promise((resolve, reject) => {
        store.get('current', (error, value) => error ? reject(error) : resolve(value));
    });

    assert.equal(restoredSession.user.id, 'current');
});
