import crypto from 'node:crypto';

const PREFIX = 'panel-session-v2:';
const AAD = Buffer.from('Panel session store v2', 'utf8');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Derive the file-encryption key once per server startup. The file store's
 * default codec performs synchronous scrypt on every read, touch and write,
 * blocking the event loop even for read-only authenticated requests.
 * A random persistent store salt preserves password stretching; fresh GCM IVs
 * ensure that each write remains independently authenticated and randomized.
 */
export function createSessionCodec(secret, salt) {
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
        throw new Error('Session encryption requires a secret of at least 32 bytes.');
    }
    if (typeof salt !== 'string' || !/^[a-f0-9]{64}$/.test(salt)) {
        throw new Error('Session encryption requires a 32-byte store salt.');
    }
    const key = crypto.scryptSync(secret, Buffer.from(salt, 'hex'), 32);

    return {
        encoder(session) {
            const iv = crypto.randomBytes(IV_BYTES);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(AAD);
            const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
            return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
        },
        decoder(serialized) {
            if (typeof serialized !== 'string' || !serialized.startsWith(PREFIX)) {
                throw new Error('Unsupported encrypted session format.');
            }
            const encoded = serialized.slice(PREFIX.length);
            const payload = Buffer.from(encoded, 'base64');
            if (payload.length <= IV_BYTES + TAG_BYTES || payload.toString('base64') !== encoded) {
                throw new Error('Invalid encrypted session payload.');
            }
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(0, IV_BYTES));
            decipher.setAAD(AAD);
            decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
            const plaintext = Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
            const session = JSON.parse(plaintext.toString('utf8'));
            if (!session || typeof session !== 'object' || Array.isArray(session)) {
                throw new Error('Invalid decrypted session object.');
            }
            return session;
        }
    };
}
