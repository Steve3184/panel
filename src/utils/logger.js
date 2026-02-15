import fs from 'fs-extra';
import path from 'path';
import util from 'util';

const LOG_DIR = path.resolve('logs');
const MAX_LOG_FILES = 100;

const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
};

function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getLogFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return path.join(LOG_DIR, `${year}-${month}-${day}.log`);
}

async function cleanOldLogs() {
    try {
        await fs.ensureDir(LOG_DIR);
        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.log$/)).sort();

        if (logFiles.length > MAX_LOG_FILES) {
            const toDelete = logFiles.slice(0, logFiles.length - MAX_LOG_FILES);
            for (const file of toDelete) {
                const filePath = path.join(LOG_DIR, file);
                await fs.remove(filePath);
            }
        }
    } catch (err) {
        originalConsole.error('[Logger] Failed to clean logs:', err);
    }
}

async function writeLog(level, args) {
    const logFile = getLogFileName();
    const timestamp = getTimestamp();
    const msg = util.format(...args);
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${msg}
`;

    try {
        await fs.ensureDir(LOG_DIR);
        await fs.appendFile(logFile, logLine);
    } catch (err) {
        originalConsole.error('[Logger] Failed to write log', err);
    }
}

let currentLogDate = '';

function checkRotation() {
    const now = new Date();
    const dateStr = now.toDateString();
    if (dateStr !== currentLogDate) {
        currentLogDate = dateStr;
        cleanOldLogs();
    }
}

export function initLogger() {
    checkRotation();

    console.log = (...args) => {
        originalConsole.log(...args);
        checkRotation();
        writeLog('info', args);
    };

    console.info = (...args) => {
        originalConsole.info(...args);
        checkRotation();
        writeLog('info', args);
    };

    console.warn = (...args) => {
        originalConsole.warn(...args);
        checkRotation();
        writeLog('warn', args);
    };

    console.error = (...args) => {
        originalConsole.error(...args);
        checkRotation();
        writeLog('error', args);
    };

    console.debug = (...args) => {
        if (originalConsole.debug) originalConsole.debug(...args);
        checkRotation();
        writeLog('debug', args);
    };
}
