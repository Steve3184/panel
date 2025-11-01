import fs from 'fs-extra';

/**
 * 从 JSON 文件中读取数据。
 * @param {string} filePath 文件路径
 * @param {any} [defaultValue=[]] 如果文件不存在或为空时返回的默认值
 * @returns {any} 解析后的 JSON 数据或默认值
 */
export function readDb(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8').trim() === '') {
            return defaultValue;
        }
        return fs.readJsonSync(filePath);
    } catch (e) {
        console.error(`Error reading or parsing DB file at ${filePath}:`, e);
        return defaultValue;
    }
}

/**
 * 将数据写入 JSON 文件。
 * @param {string} filePath 文件路径
 * @param {any} data 要写入的数据
 */
export function writeDb(filePath, data) {
    try {
        fs.writeJsonSync(filePath, data, { spaces: 2 });
    } catch (e) {
        console.error(`Error writing to DB file at ${filePath}:`, e);
    }
}