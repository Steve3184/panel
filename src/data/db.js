import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

/**
 * 从 JSON 文件中读取数据。
 * @param {string} filePath 文件路径
 * @param {any} [defaultValue=[]] 如果文件不存在或为空时返回的默认值
 * @returns {any} 解析后的 JSON 数据或默认值
 */
export function readDb(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.trim() === '') throw new Error('Database file is empty.');
        return JSON.parse(content);
    } catch (e) {
        console.error(`Error reading or parsing DB file at ${filePath}:`, e);
        throw e;
    }
}

/**
 * 将数据写入 JSON 文件。
 * @param {string} filePath 文件路径
 * @param {any} data 要写入的数据
 */
export function writeDb(filePath, data) {
    let tempPath;
    try {
        const directory = path.dirname(filePath);
        fs.ensureDirSync(directory, 0o700);
        tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
        const descriptor = fs.openSync(tempPath, 'wx', 0o600);
        try {
            fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(tempPath, filePath);
        fs.chmodSync(filePath, 0o600);
        if (process.platform !== 'win32') {
            const directoryDescriptor = fs.openSync(directory, 'r');
            try {
                fs.fsyncSync(directoryDescriptor);
            } finally {
                fs.closeSync(directoryDescriptor);
            }
        }
    } catch (e) {
        if (tempPath) fs.removeSync(tempPath);
        console.error(`Error writing to DB file at ${filePath}:`, e);
        throw e;
    }
}
