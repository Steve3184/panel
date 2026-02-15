import fs from 'fs-extra';
import path from 'path';

const LOG_DIR = path.resolve('logs');

export const listLogs = async (req, res) => {
    try {
        await fs.ensureDir(LOG_DIR);
        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.log$/)).sort().reverse();
        res.json(logFiles);
    } catch (error) {
        console.error('Failed to list logs:', error);
        res.status(500).json({ message: 'server.failed_to_list_logs' });
    }
};

export const getLogContent = async (req, res) => {
    try {
        const { filename } = req.params;
        if (!filename.match(/^\d{4}-\d{2}-\d{2}\.log$/)) {
             return res.status(400).json({ message: 'server.invalid_log_filename' });
        }

        const filePath = path.join(LOG_DIR, filename);
        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({ message: 'server.log_file_not_found' });
        }

        const content = await fs.readFile(filePath, 'utf8');
        res.json({ content });
    } catch (error) {
        console.error('Failed to read log file:', error);
        res.status(500).json({ message: 'server.failed_to_read_log_file' });
    }
};
