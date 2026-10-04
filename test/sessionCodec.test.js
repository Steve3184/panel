import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import { createSessionCodec } from '../src/utils/sessionCodec.js';
import { prepareSessionStore } from '../src/utils/security.js';

const temporaryDirectories = new Set();
const secret = 'test-only-session-secret-'.repeat(3);
const salt = 'a1'.repeat(32);
const sessionValue = { cookie: { originalMaxAge: 60000 }, user: { id: 'reader', role: 'user' } };

async function temporaryDirectory() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-codec-'));
    temporaryDirectories.add(directory);
    return directory;
}
afterEach(async () => {
    await Promise.all([...temporaryDirectories].map(directory => fs.remove(directory)));
    temporaryDirectories.clear();
});

test('session codec encrypts at rest, round-trips and randomizes each write', () => {
    const codec = createSessionCodec(secret, salt);
    const first = codec.encoder(sessionValue);
    const second = codec.encoder(sessionValue);
    assert.notEqual(first, second);
    assert.equal(first.includes('reader'), false);
    assert.deepEqual(codec.decoder(first), sessionValue);
    assert.deepEqual(createSessionCodec(secret, salt).decoder(second), sessionValue);
});

test('session codec rejects tampering of IV, tag and ciphertext', () => {
    const codec = createSessionCodec(secret, salt);
    const serialized = codec.encoder(sessionValue);
    const prefix = 'panel-session-v2:';
    for (const index of [0, 12, 28]) {
        const payload = Buffer.from(serialized.slice(prefix.length), 'base64');
        payload[index] ^= 1;
        assert.throws(() => codec.decoder(prefix + payload.toString('base64')));
    }
});

test('session codec rejects wrong keys, store salts and invalid formats', () => {
    const codec = createSessionCodec(secret, salt);
    const serialized = codec.encoder(sessionValue);
    assert.throws(() => createSessionCodec('wrong-secret-'.repeat(4), salt).decoder(serialized));
    assert.throws(() => createSessionCodec(secret, 'b2'.repeat(32)).decoder(serialized));
    for (const value of [JSON.stringify(sessionValue), '', 'panel-session-v1:abc', 'panel-session-v2:!bad!', 'panel-session-v2:AA==']) {
        assert.throws(() => codec.decoder(value));
    }
    assert.throws(() => createSessionCodec('short', salt));
    assert.throws(() => createSessionCodec(secret, 'invalid'));
});

test('session codec does not repeat scrypt when reading or writing sessions', () => {
    const original = crypto.scryptSync;
    let calls = 0;
    crypto.scryptSync = (...args) => { calls++; return original(...args); };
    try {
        const codec = createSessionCodec(secret, salt);
        for (let index = 0; index < 10; index++) assert.deepEqual(codec.decoder(codec.encoder(sessionValue)), sessionValue);
        assert.equal(calls, 1);
    } finally { crypto.scryptSync = original; }
});

test('v1 session metadata migrates once and persists the v2 random store salt', async () => {
    const directory = await temporaryDirectory();
    await fs.writeJson(path.join(directory, '.panel-session-store'), {
        format: 1, secretFingerprint: crypto.createHash('sha256').update(secret).digest('hex')
    });
    await fs.writeFile(path.join(directory, 'old.json'), 'old encrypted session');
    const migrated = await prepareSessionStore(directory, secret);
    assert.equal(migrated.reset, true);
    assert.equal(migrated.removedSessions, 1);
    assert.match(migrated.encryptionSalt, /^[a-f0-9]{64}$/);
    const unchanged = await prepareSessionStore(directory, secret);
    assert.equal(unchanged.reset, false);
    assert.equal(unchanged.encryptionSalt, migrated.encryptionSalt);
    const metadata = await fs.readJson(migrated.metadataPath);
    assert.equal(metadata.format, 2);
    await fs.writeJson(migrated.metadataPath, { ...metadata, encryptionSalt: 'invalid' });
    const repaired = await prepareSessionStore(directory, secret);
    assert.equal(repaired.reset, true);
    assert.notEqual(repaired.encryptionSalt, migrated.encryptionSalt);
});

test('file store uses encrypted codec across set, get, touch and restart', async () => {
    const directory = await temporaryDirectory();
    const prepared = await prepareSessionStore(directory, secret);
    const FileStore = FileStoreFactory(session);
    const createStore = () => new FileStore({
        path: directory, reapInterval: -1, retries: 0, logFn() {},
        ...createSessionCodec(secret, prepared.encryptionSalt)
    });
    const call = (store, method, ...args) => new Promise((resolve, reject) => {
        store[method](...args, (error, value) => error ? reject(error) : resolve(value));
    });
    const store = createStore();
    await call(store, 'set', 'current', structuredClone(sessionValue));
    assert.equal((await fs.readFile(path.join(directory, 'current.json'), 'utf8')).includes('reader'), false);
    assert.equal((await call(store, 'get', 'current')).user.id, 'reader');
    await call(store, 'touch', 'current', { cookie: { originalMaxAge: 120000 } });
    const restored = await call(createStore(), 'get', 'current');
    assert.equal(restored.user.id, 'reader');
    assert.equal(restored.cookie.originalMaxAge, 120000);
    await fs.writeFile(path.join(directory, 'current.json'), 'tampered');
    await assert.rejects(call(store, 'get', 'current'));
    assert.equal(await fs.pathExists(path.join(directory, 'current.json')), false);
});
