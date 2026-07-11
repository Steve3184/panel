import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Busboy from 'busboy';
import sevenBin from '7zip-bin';
import SevenZip from 'node-7z';
import { TarArchive } from 'archiver';
import * as tar from 'tar';
import yauzl from 'yauzl';
import { spawn } from 'child_process';
import { once } from 'events';
import { pipeline } from 'stream/promises';

import { getFileAbsolutePath, getInstanceRootPath, isPathWithinRoot, activeUploads } from '../../core/fileManager.js';
import { UPLOAD_TEMP_DIR } from '../../config.js';
import { broadcastToInstance } from '../../websocket/handler.js';
import i18n from '../../utils/i18n.js';

const pathTo7zip = sevenBin.path7za;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_EXTRACTED_SIZE = 4 * 1024 * 1024 * 1024;
const MAX_ACTIVE_UPLOADS_PER_USER = 4;
const UPLOAD_TTL_MS = 30 * 60 * 1000;

async function cleanupUpload(uploadId) {
    const upload = activeUploads.get(uploadId);
    if (!upload) return;
    activeUploads.delete(uploadId);
    if (upload.timeout) clearTimeout(upload.timeout);
    if (upload.writeStream && !upload.writeStream.destroyed) upload.writeStream.destroy();
    await fs.remove(upload.tempFilePath).catch(() => {});
}

function scheduleUploadExpiry(uploadId, upload) {
    if (upload.timeout) clearTimeout(upload.timeout);
    upload.timeout = setTimeout(() => {
        cleanupUpload(uploadId).catch(() => {});
    }, UPLOAD_TTL_MS);
    upload.timeout.unref?.();
}

function assertSafeArchiveEntry(entryPath) {
    const normalized = entryPath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || segments.includes('..')) {
        throw new Error('Access denied: Archive contains an unsafe path.');
    }
}

async function canExecute(binary) {
    return new Promise(resolve => {
        const child = spawn(binary, [], { stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('close', () => resolve(true));
    });
}

let resolvedSevenZipBinary;
async function getSevenZipBinary() {
    if (resolvedSevenZipBinary) return resolvedSevenZipBinary;
    const candidates = [process.env.SEVEN_ZIP_BIN, '7zz', '7z', '7za', pathTo7zip].filter(Boolean);
    for (const candidate of candidates) {
        if (await canExecute(candidate)) {
            resolvedSevenZipBinary = candidate;
            return candidate;
        }
    }
    throw new Error('7-Zip executable not found.');
}

async function extract7zSafely(archivePath, stagingPath, onProgress) {
    const binary = await getSevenZipBinary();
    let entryCount = 0;
    let totalSize = 0;

    await new Promise((resolve, reject) => {
        const listStream = SevenZip.list(archivePath, { techInfo: true, $bin: binary });
        listStream.on('data', entry => {
            try {
                entryCount += 1;
                const techInfo = entry.techInfo || new Map();
                const entryPath = entry.file || techInfo.get('Path');
                const attributes = String(entry.attributes || techInfo.get('Attributes') || '');
                const linkTarget = techInfo.get('Symbolic Link') || techInfo.get('Hard Link');
                assertSafeArchiveEntry(entryPath);
                totalSize += Number(entry.size ?? techInfo.get('Size')) || 0;
                if (entryCount > MAX_ARCHIVE_ENTRIES || totalSize > MAX_EXTRACTED_SIZE) {
                    throw new Error('Archive exceeds extraction limits.');
                }
                if (linkTarget || /(?:^|\s)l[rwx-]{9}(?:\s|$)/i.test(attributes) || /reparse/i.test(attributes)) {
                    throw new Error('Access denied: Archive contains a link.');
                }
            } catch (error) {
                listStream.destroy();
                reject(error);
            }
        });
        listStream.once('error', reject);
        listStream.once('end', resolve);
    });

    await new Promise((resolve, reject) => {
        const extractStream = SevenZip.extractFull(archivePath, stagingPath, {
            $progress: true,
            $bin: binary,
            recursive: true
        });
        extractStream.on('progress', progress => onProgress(Math.min(99, progress.percent || 0)));
        extractStream.once('error', reject);
        extractStream.once('end', resolve);
    });
}

async function extractZipSafely(archivePath, stagingPath, onProgress) {
    await new Promise((resolve, reject) => {
        yauzl.open(archivePath, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (openError, zipFile) => {
            if (openError) return reject(openError);
            let entryCount = 0;
            let totalSize = 0;

            const fail = (error) => {
                zipFile.close();
                reject(error);
            };

            zipFile.on('error', fail);
            zipFile.on('end', resolve);
            zipFile.on('entry', async (entry) => {
                try {
                    entryCount += 1;
                    totalSize += entry.uncompressedSize;
                    if (entryCount > MAX_ARCHIVE_ENTRIES || totalSize > MAX_EXTRACTED_SIZE) {
                        throw new Error('Archive exceeds extraction limits.');
                    }

                    assertSafeArchiveEntry(entry.fileName);
                    if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
                        throw new Error('Encrypted archives are not supported.');
                    }

                    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
                    if ((unixMode & 0o170000) === 0o120000) {
                        throw new Error('Access denied: Archive contains a symbolic link.');
                    }

                    const outputPath = path.resolve(stagingPath, entry.fileName);
                    if (!isPathWithinRoot(stagingPath, outputPath)) {
                        throw new Error('Access denied: Archive path escapes extraction directory.');
                    }

                    if (entry.fileName.endsWith('/')) {
                        await fs.ensureDir(outputPath);
                    } else {
                        await fs.ensureDir(path.dirname(outputPath));
                        const readStream = await new Promise((streamResolve, streamReject) => {
                            zipFile.openReadStream(entry, (error, stream) => error ? streamReject(error) : streamResolve(stream));
                        });
                        await pipeline(readStream, fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
                    }

                    onProgress(Math.min(99, Math.round((entryCount / Math.max(zipFile.entryCount, 1)) * 100)));
                    zipFile.readEntry();
                } catch (error) {
                    fail(error);
                }
            });
            zipFile.readEntry();
        });
    });
}

function createTarOptions(stagingPath, onProgress) {
    let entryCount = 0;
    let totalSize = 0;
    let validationError = null;
    return {
        options: {
            cwd: stagingPath,
            strict: true,
            preservePaths: false,
            noChmod: true,
            filter: (entryPath, entry) => {
                try {
                    assertSafeArchiveEntry(entryPath);
                    entryCount += 1;
                    totalSize += Number(entry.size) || 0;
                    if (entryCount > MAX_ARCHIVE_ENTRIES || totalSize > MAX_EXTRACTED_SIZE) {
                        throw new Error('Archive exceeds extraction limits.');
                    }
                    if (!['File', 'OldFile', 'ContiguousFile', 'Directory'].includes(entry.type)) {
                        throw new Error(`Access denied: Unsupported archive entry type ${entry.type}.`);
                    }
                    onProgress(Math.min(99, Math.max(1, Math.round(entryCount / MAX_ARCHIVE_ENTRIES * 100))));
                    return true;
                } catch (error) {
                    validationError ||= error;
                    return false;
                }
            }
        },
        getValidationError: () => validationError
    };
}

async function extractTarSafely(archivePath, stagingPath, isXz, onProgress) {
    const validation = createTarOptions(stagingPath, onProgress);
    if (!isXz) {
        await tar.extract({ ...validation.options, file: archivePath });
        if (validation.getValidationError()) throw validation.getValidationError();
        return;
    }

    const xzProcess = spawn('xz', ['-dc', '--', archivePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    xzProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
    await pipeline(xzProcess.stdout, tar.extract(validation.options));
    const [exitCode] = await once(xzProcess, 'close');
    if (exitCode !== 0) throw new Error(`xz extraction failed: ${stderr.trim()}`);
    if (validation.getValidationError()) throw validation.getValidationError();
}

async function validateExtractedTree(rootPath, state = { entries: 0, size: 0 }) {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);
        const stats = await fs.lstat(entryPath);
        state.entries += 1;
        state.size += stats.isFile() ? stats.size : 0;
        if (state.entries > MAX_ARCHIVE_ENTRIES || state.size > MAX_EXTRACTED_SIZE) {
            throw new Error('Archive exceeds extraction limits.');
        }
        if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
            throw new Error('Access denied: Archive produced an unsafe file type.');
        }
        if (stats.isDirectory()) await validateExtractedTree(entryPath, state);
    }
}

async function assertSafeSourceTree(sourcePath) {
    const stats = await fs.lstat(sourcePath);
    if (stats.isSymbolicLink()) {
        throw new Error('Access denied: Symbolic links cannot be copied or archived.');
    }
    if (!stats.isDirectory()) return;
    const entries = await fs.readdir(sourcePath);
    for (const entry of entries) {
        await assertSafeSourceTree(path.join(sourcePath, entry));
    }
}

async function copyExtractedTree(instanceId, sourceRoot, destinationRelativePath) {
    const walk = async (currentSource, currentRelative = '') => {
        const entries = await fs.readdir(currentSource, { withFileTypes: true });
        for (const entry of entries) {
            const sourcePath = path.join(currentSource, entry.name);
            const relativePath = path.join(currentRelative, entry.name);
            const targetRelativePath = path.join(destinationRelativePath, relativePath);
            const targetPath = await getFileAbsolutePath(instanceId, targetRelativePath, { allowMissing: true });
            if (entry.isDirectory()) {
                await fs.ensureDir(targetPath, 0o700);
                await walk(sourcePath, relativePath);
            } else {
                await fs.ensureDir(path.dirname(targetPath), 0o700);
                await fs.copyFile(sourcePath, targetPath);
                await fs.chmod(targetPath, 0o600);
            }
        }
    };
    await walk(sourceRoot);
}

// --- 辅助函数 ---
const handleFileError = (res, error, defaultMessage) => {
    if (error.message.includes('Instance not found')) {
        return res.status(404).json({ message: 'server.instance_not_found' });
    }
    if (error.message.includes('Access denied')) {
        return res.status(403).json({ message: 'server.access_denied_outside' });
    }
    if (error.code === 'ENOENT') {
        return res.status(404).json({ message: 'server.file_not_found' });
    }
    console.error(defaultMessage, error);
    res.status(500).json({ message: defaultMessage, error: error.message });
};

// --- 控制器方法 ---
export const listFiles = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const absolutePath = await getFileAbsolutePath(instanceId, relativePath);

        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ message: 'Path is not a directory.' });
        }

        const files = await fs.readdir(absolutePath);
        const fileDetails = await Promise.all(files.map(async file => {
            try {
                const filePath = path.join(absolutePath, file);
                const fileStats = await fs.lstat(filePath);
                if (fileStats.isSymbolicLink()) return null;
                return {
                    name: file,
                    path: path.join(relativePath, file),
                    isDirectory: fileStats.isDirectory(),
                    size: fileStats.size,
                    mtime: fileStats.mtime,
                };
            } catch { return null; }
        }));
        res.json(fileDetails.filter(Boolean));
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_list_files');
    }
};

export const getFileContent = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const absolutePath = await getFileAbsolutePath(instanceId, relativePath);

        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) return res.status(400).json({ message: 'server.path_not_file' });
        if (stats.size > 2 * 1024 * 1024) return res.status(413).json({ message: 'server.file_too_large_for_edit' });

        const content = await fs.readFile(absolutePath, 'utf8');
        res.json({ content });
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_get_file_content');
    }
};

export const downloadFile = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const absolutePath = await getFileAbsolutePath(instanceId, relativePath);
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) return res.status(400).json({ message: 'server.path_not_file' });

        res.download(absolutePath, path.basename(absolutePath));
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_download_file');
    }
};

export const createDirectory = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'server.directory_name_required' });

        const newDirPath = path.join(relativePath, name);
        const absolutePath = await getFileAbsolutePath(instanceId, newDirPath, { allowMissing: true });

        await fs.ensureDir(absolutePath);
        res.status(201).json({ message: 'server.ok', path: newDirPath });
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_create_directory');
    }
};

export const createFile = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        const { name, content } = req.body;
        if (!name) return res.status(400).json({ message: 'server.file_name_required' });

        const newFilePath = path.join(relativePath, name);
        const absolutePath = await getFileAbsolutePath(instanceId, newFilePath, { allowMissing: true });

        await fs.ensureDir(path.dirname(absolutePath));
        await fs.writeFile(absolutePath, content || '');
        res.status(201).json({ message: 'server.ok', path: newFilePath });
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_create_file');
    }
};

export const deletePath = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const relativePath = req.params[0] || '';
        if (!relativePath) return res.status(400).json({ message: 'Path is required.' });

        const absolutePath = await getFileAbsolutePath(instanceId, relativePath);
        const instanceCwd = await fs.realpath(getInstanceRootPath(instanceId));
        if (absolutePath === instanceCwd) {
            return res.status(403).json({ message: 'Cannot delete instance root.' });
        }

        await fs.remove(absolutePath);
        res.status(204).send();
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_delete_file_or_directory');
    }
};

export const renamePath = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { oldPath, newName } = req.body;
        if (!oldPath || !newName) return res.status(400).json({ message: 'Old path and new name are required.' });

        if (path.basename(newName) !== newName || newName === '.' || newName === '..') {
            return res.status(400).json({ message: 'server.invalid_action' });
        }
        const oldAbsolutePath = await getFileAbsolutePath(instanceId, oldPath);
        const newRelativePath = path.join(path.dirname(oldPath), newName);
        const newAbsolutePath = await getFileAbsolutePath(instanceId, newRelativePath, { allowMissing: true });

        await fs.move(oldAbsolutePath, newAbsolutePath);
        res.json({ message: 'server.ok' });
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_rename');
    }
};

export const initUpload = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { fileName, fileSize, targetDirectory } = req.body;

        if (!fileName || typeof fileSize !== 'number' || fileSize <= 0) {
            return res.status(400).json({ message: 'server.invalid_file_details' });
        }
        // 16GB limit per file; concurrent upload count and expiry are enforced separately.
        const MAX_FILE_SIZE = 16 * 1024 * 1024 * 1024;
        if (fileSize > MAX_FILE_SIZE) {
            return res.status(413).json({ message: 'server.file_size_exceeds_limit' });
        }
        const activeUploadCount = [...activeUploads.values()].filter(upload => upload.userId === req.session.user.id).length;
        if (activeUploadCount >= MAX_ACTIVE_UPLOADS_PER_USER) {
            return res.status(429).json({ message: 'server.too_many_uploads' });
        }

        const uploadId = uuidv4();
        const tempFilePath = path.join(UPLOAD_TEMP_DIR, uploadId);
        if (path.basename(fileName) !== fileName) {
            return res.status(400).json({ message: 'server.invalid_file_details' });
        }
        const targetPath = await getFileAbsolutePath(instanceId, path.join(targetDirectory || '.', fileName), { allowMissing: true });

        fs.ensureDirSync(path.dirname(targetPath));

        const upload = {
            instanceId,
            userId: req.session.user.id,
            fileName,
            fileSize,
            tempFilePath,
            targetPath,
            receivedSize: 0,
            writeStream: null,
            busy: false,
            timeout: null
        };
        activeUploads.set(uploadId, upload);
        scheduleUploadExpiry(uploadId, upload);

        res.status(200).json({ uploadId, message: 'server.upload_initiated' });
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_initiate_upload');
    }
};

/**
 * 使用 busboy 处理文件分块上传。
 */
export const uploadChunk = (req, res) => {
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fields: 2, fileSize: 16 * 1024 * 1024 } });
    let uploadId;
    let responseSent = false;

    const respond = (status, body) => {
        if (responseSent || res.headersSent) return;
        responseSent = true;
        res.status(status).json(body);
    };

    busboy.on('field', (fieldname, val) => {
        if (fieldname === 'uploadId') uploadId = val;
    });

    busboy.on('file', (fieldname, file) => {
        const upload = activeUploads.get(uploadId);
        if (!upload || upload.instanceId !== req.params.instanceId || upload.userId !== req.session.user.id) {
            file.resume();
            respond(404, { message: 'server.upload_not_found_or_expired' });
            return;
        }
        if (upload.busy) {
            file.resume();
            respond(409, { message: 'server.upload_chunk_in_progress' });
            return;
        }
        upload.busy = true;
        scheduleUploadExpiry(uploadId, upload);
        if (!upload.writeStream) {
            upload.writeStream = fs.createWriteStream(upload.tempFilePath, { flags: 'wx', mode: 0o600 });
            upload.writeStream.on('error', () => cleanupUpload(uploadId).catch(() => {}));
        }

        file.on('data', (data) => {
            if (upload.writeStream && upload.receivedSize + data.length <= upload.fileSize) {
                upload.receivedSize += data.length;
                if (!upload.writeStream.write(data)) {
                    file.pause();
                    upload.writeStream.once('drain', () => file.resume());
                }
            } else {
                file.destroy(new Error('Upload exceeds declared file size.'));
            }
        });
        file.on('end', () => {
            upload.busy = false;
            respond(200, { message: 'server.ok', receivedSize: upload.receivedSize });
        });
        file.on('error', () => cleanupUpload(uploadId).catch(() => {}));
        file.on('limit', () => {
            cleanupUpload(uploadId).catch(() => {});
            respond(413, { message: 'server.file_size_exceeds_limit' });
        });
    });

    busboy.on('error', (err) => {
        respond(400, { message: 'server.file_upload_chunk_failed_parsing', error: err.message });
    });

    req.pipe(busboy);
};

/**
 * 完成文件上传，将临时文件移动到最终位置。
 */
export const completeUpload = async (req, res) => {
    try {
        const { uploadId } = req.body;
        const upload = activeUploads.get(uploadId);

        if (!upload || upload.instanceId !== req.params.instanceId || upload.userId !== req.session.user.id) {
            return res.status(404).json({ message: 'server.upload_not_found_or_expired' });
        }
        if (upload.busy) return res.status(409).json({ message: 'server.upload_chunk_in_progress' });

        // 关闭写文件流
        if (upload.writeStream) {
            upload.writeStream.end();
            await once(upload.writeStream, 'finish');
        }

        // 验证文件大小是否匹配
        if (upload.receivedSize !== upload.fileSize) {
            await cleanupUpload(uploadId);
            return res.status(400).json({ message: 'server.not_all_chunks_received' });
        }

        // 移动文件
        await fs.move(upload.tempFilePath, upload.targetPath, { overwrite: true });

        // 清理
        if (upload.timeout) clearTimeout(upload.timeout);
        activeUploads.delete(uploadId);

        const relativeFilePath = path.relative(await fs.realpath(getInstanceRootPath(req.params.instanceId)), upload.targetPath);
        res.status(200).json({ message: 'server.file_uploaded_successfully', filePath: relativeFilePath });

    } catch (error) {
        handleFileError(res, error, 'server.failed_to_complete_upload');
    }
};

// --- 压缩与解压 (后台任务模式) ---

/**
 * 解压文件。立即返回 202 Accepted，通过 WebSocket 发送进度。
 */
export const extractArchive = async (req, res) => {
    const { instanceId } = req.params;
    const { filePath, destinationPath } = req.body;
    if (!filePath) return res.status(400).json({ message: 'server.file_path_required' });

    try {
        const destinationRelativePath = destinationPath || path.dirname(filePath);
        const absoluteFilePath = await getFileAbsolutePath(instanceId, filePath);
        const absoluteDestinationPath = await getFileAbsolutePath(instanceId, destinationRelativePath, { allowMissing: true });
        await fs.ensureDir(absoluteDestinationPath);

        const extractId = uuidv4();
        const fileExtension = path.extname(filePath).toLowerCase();
        const baseName = path.basename(filePath);
        res.status(202).json({ message: 'server.file_extract_request_accepted', extractId });

        // --- 后台处理逻辑 ---
        (async () => {
            const sendProgress = (progress) => {
                broadcastToInstance(instanceId, {
                    type: 'file-extract-progress',
                    extractId: extractId,
                    fileName: baseName,
                    status: 'in-progress',
                    progress: progress // 0-100
                }, null, true);
            };

            const sendCompletion = (status, message) => {
                broadcastToInstance(instanceId, {
                    type: 'file-extract-status',
                    extractId: extractId,
                    fileName: baseName,
                    status: status,
                    message: message
                }, null, true);
                if (status === 'success') {
                    broadcastToInstance(instanceId, {
                        type: 'file-change',
                        instanceId: instanceId,
                        path: destinationPath || path.dirname(filePath),
                    }, null, true);
                }
            };

            const stagingPath = path.join(UPLOAD_TEMP_DIR, `extract-${extractId}`);
            try {
                await fs.ensureDir(stagingPath, 0o700);
                const lowerPath = filePath.toLowerCase();
                if (fileExtension === '.zip') {
                    await extractZipSafely(absoluteFilePath, stagingPath, sendProgress);
                } else if (fileExtension === '.7z') {
                    await extract7zSafely(absoluteFilePath, stagingPath, sendProgress);
                } else if (lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz') || lowerPath.endsWith('.tar')) {
                    await extractTarSafely(absoluteFilePath, stagingPath, false, sendProgress);
                } else if (lowerPath.endsWith('.tar.xz')) {
                    await extractTarSafely(absoluteFilePath, stagingPath, true, sendProgress);
                } else {
                    sendCompletion('error', 'server.unsupported_archive_type');
                    return;
                }

                await validateExtractedTree(stagingPath);
                await copyExtractedTree(instanceId, stagingPath, destinationRelativePath);
                sendProgress(100);
                console.log(i18n.t('server.file_extracted_success_log', { filePath, absoluteDestinationPath }));
                sendCompletion('success', 'server.file_extracted_success');

            } catch (error) {
                if (error.message.includes('Instance not found')) {
                    sendCompletion('error', 'server.instance_not_found');
                    return;
                }
                if (error.message.includes('Access denied')) {
                    sendCompletion('error', 'server.no_perms');
                    return;
                }
                if (error.code === 'ENOENT') {
                    sendCompletion('error', 'server.file_or_directory_not_found_error');
                    return;
                }
                console.error('server.extract_api_internal_error_log', error);
                sendCompletion('error', 'server.extract_api_internal_error');
            } finally {
                await fs.remove(stagingPath);
            }
        })();

    } catch (error) {
        handleFileError(res, error, 'server.failed_to_initiate_extraction');
    }
};

/**
 * 压缩文件或目录。立即返回 202 Accepted，通过 WebSocket 发送进度。
 */
export const compressFiles = async (req, res) => {
    const { instanceId } = req.params;
    const { filesToCompress, destinationPath, outputName, format, level } = req.body;
    if (!filesToCompress?.length || !outputName || !format) {
        return res.status(400).json({ message: 'server.missing_compress_details' });
    }

    try {
        if (path.basename(outputName) !== outputName) {
            return res.status(400).json({ message: 'server.invalid_action' });
        }
        const absoluteDestinationPath = await getFileAbsolutePath(instanceId, destinationPath || '', { allowMissing: true });
        const absoluteOutputFilePath = await getFileAbsolutePath(instanceId, path.join(destinationPath || '', outputName), { allowMissing: true });

        const filesToCompressAbsolutePaths = await Promise.all(filesToCompress.map(file => getFileAbsolutePath(instanceId, file)));
        await Promise.all(filesToCompressAbsolutePaths.map(assertSafeSourceTree));

        const compressId = uuidv4();
        res.status(202).json({ message: 'server.file_compress_request_accepted', compressId });

        // --- 后台处理逻辑 ---
        (async () => {
            const sendProgress = (progress) => {
                broadcastToInstance(instanceId, {
                    type: 'file-compress-progress',
                    compressId: compressId,
                    outputName: outputName,
                    status: 'in-progress',
                    progress: progress // 0-100
                }, null, true);
            };

            const sendCompletion = (status, message) => {
                broadcastToInstance(instanceId, {
                    type: 'file-compress-status',
                    compressId: compressId,
                    outputName: outputName,
                    status: status,
                    message: message
                }, null, true);
                if (status === 'success') {
                    broadcastToInstance(instanceId, {
                        type: 'file-change',
                        instanceId: instanceId,
                        path: destinationPath || ''
                    }, null, true);
                }
            };

            const compressionLevel = Math.max(0, Math.min(9, level || 5)); // 确保压缩级别在 0-9 之间
            try {
                switch (format) {
                    case 'zip':
                    case '7z':
                        // 使用 node-7z 库的 add 方法
                        const sevenZAddStream = SevenZip.add(absoluteOutputFilePath, filesToCompressAbsolutePaths, {
                            recursive: true, // 递归添加文件和文件夹
                            $progress: true,
                            $bin: pathTo7zip,
                            mx: compressionLevel // 压缩级别
                        });
                        let lastProgress = -1;
                        sevenZAddStream.on('progress', (progress) => {
                            if (lastProgress < progress.percent) {
                                sendProgress(progress.percent);
                                lastProgress = progress.percent;
                            }
                        });

                        sevenZAddStream.on('end', () => {
                            console.log(i18n.t('server.file_compressed_success_log', { absoluteOutputFilePath: absoluteOutputFilePath }));
                            sendProgress(100);
                            sendCompletion('success', i18n.t('server.file_compressed_success', { outputName: outputName }));
                        });

                        sevenZAddStream.on('error', (err) => {
                            console.error(i18n.t('server.file_compress_failed_log', { outputName: outputName }), err);
                            sendCompletion('error', i18n.t('server.file_compress_failed', { outputName: outputName, message: err.message }));
                        });
                        return; // 阻止继续执行 exec
                    case 'tar.gz': {
                        const archive = new TarArchive({
                            gzip: true,
                            gzipOptions: { level: compressionLevel }
                        });

                        const output = fs.createWriteStream(absoluteOutputFilePath);
                        archive.pipe(output);

                        let totalSize = 0;
                        let processedSize = 0;

                        for (const filePath of filesToCompressAbsolutePaths) {
                            const stats = await fs.stat(filePath);
                            totalSize += stats.size;
                        }

                        archive.on('progress', (progress) => {
                            processedSize = progress.fs.processedBytes;
                            if (totalSize > 0) {
                                const percent = Math.round((processedSize / totalSize) * 100);
                                sendProgress(percent);
                            }
                        });

                        archive.on('error', (err) => {
                            console.error(i18n.t('server.file_compress_failed_log', { outputName: outputName }), err);
                            sendCompletion('error', i18n.t('server.file_compress_failed', { outputName: outputName, message: err.message }));
                        });

                        output.on('close', () => {
                            console.log(i18n.t('server.file_compressed_success_log', { absoluteOutputFilePath: absoluteOutputFilePath }));
                            sendProgress(100);
                            sendCompletion('success', i18n.t('server.file_compressed_success', { outputName: outputName }));
                        });

                        for (const filePath of filesToCompressAbsolutePaths) {
                            const stat = await fs.stat(filePath);
                            const entryName = path.relative(absoluteDestinationPath, filePath);
                            if (stat.isDirectory()) {
                                archive.directory(filePath, entryName);
                            } else {
                                archive.file(filePath, { name: entryName });
                            }
                        }

                        archive.finalize();
                        return;
                    }
                    case 'tar.xz': {
                        // 对于 tar.xz，archiver 不直接支持 xz 压缩，需要通过管道连接到 xz 进程
                        const archive = new TarArchive(); // 创建 tar 归档，不进行 gzip 压缩

                        const outputStream = fs.createWriteStream(absoluteOutputFilePath);
                        const xzProcess = spawn('xz', ['-z', '-T0', '-c']); // -T0 使用所有可用核心，-c 输出到 stdout

                        archive.pipe(xzProcess.stdin); // archiver 的输出作为 xz 进程的输入
                        xzProcess.stdout.pipe(outputStream); // xz 进程的输出写入文件

                        let totalSize = 0;
                        let processedSize = 0;

                        for (const filePath of filesToCompressAbsolutePaths) {
                            const stats = await fs.stat(filePath);
                            totalSize += stats.size;
                        }

                        archive.on('progress', (progress) => {
                            processedSize = progress.fs.processedBytes;
                            if (totalSize > 0) {
                                const percent = Math.round((processedSize / totalSize) * 100);
                                sendProgress(percent - 1);
                            }
                        });

                        archive.on('error', (err) => {
                            console.error(i18n.t('server.tar_archive_creation_failed_log', { outputName: outputName }), err);
                            sendCompletion('error', 'server.tar_archive_creation_failed');
                            xzProcess.kill(); // 终止 xz 进程
                        });

                        xzProcess.on('error', (err) => {
                            console.error(i18n.t('server.xz_compression_process_failed_log', { outputName: outputName }), err);
                            sendCompletion('error', 'server.xz_compression_process_failed');
                        });

                        xzProcess.on('close', (code) => {
                            if (code === 0) {
                                console.log(i18n.t('server.file_compressed_success_log', { absoluteOutputFilePath: absoluteOutputFilePath }));
                                sendProgress(100);
                                sendCompletion('success', 'server.file_compressed_success');
                            } else {
                                console.error(i18n.t('server.xz_compression_process_nonzero_exit', { outputName: outputName, code: code }));
                                sendCompletion('error', 'server.xz_compression_process_nonzero_exit_message');
                            }
                        });

                        outputStream.on('error', (err) => {
                            console.error(i18n.t('server.write_xz_output_failed_log', { outputName: outputName }), err);
                            sendCompletion('error', i18n.t('server.write_xz_output_failed', { outputName: outputName, message: err.message }));
                        });

                        for (const filePath of filesToCompressAbsolutePaths) {
                            const stat = await fs.stat(filePath);
                            const entryName = path.relative(absoluteDestinationPath, filePath);
                            if (stat.isDirectory()) {
                                archive.directory(filePath, entryName);
                            } else {
                                archive.file(filePath, { name: entryName });
                            }
                        }

                        archive.finalize();
                        return;
                    }
                    default:
                        sendCompletion('error', 'server.unsupported_compress_format');
                        return;
                }
            } catch (error) {
                if (error.message.includes('Instance not found')) {
                    sendCompletion('error', 'server.instance_not_found');
                    return;
                }
                if (error.message.includes('Access denied')) {
                    sendCompletion('error', 'server.no_perms');
                    return;
                }
                if (error.code === 'ENOENT') {
                    sendCompletion('error', 'server.file_or_directory_not_found');
                    return;
                }
                console.error('server.compress_api_internal_error_log', error);
                sendCompletion('error', 'server.compress_api_internal_error', { error: error.message });
            }
        })();

    } catch (error) {
        handleFileError(res, error, 'server.failed_to_initiate_compression');
    }
};


// --- 批量操作 ---

/**
 * 复制一个或多个文件/目录。
 */
export const copyFiles = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { files, destination } = req.body;
        if (!files?.length) {
            return res.status(400).json({ message: 'server.missing_copy_details' });
        }

        const absoluteDestinationPath = await getFileAbsolutePath(instanceId, destination, { allowMissing: true });
        await fs.ensureDir(absoluteDestinationPath);

        const copyOperations = files.map(async (file) => {
            const absoluteSourcePath = await getFileAbsolutePath(instanceId, file);
            await assertSafeSourceTree(absoluteSourcePath);
            const fileName = path.basename(file);
            const absoluteTargetPath = await getFileAbsolutePath(instanceId, path.join(destination, fileName), { allowMissing: true });

            // 检查源路径和目标路径是否在同一个实例工作目录内（getFileAbsolutePath 已处理）
            // 检查是否尝试将文件复制到其自身，或其子目录
            if (absoluteSourcePath === absoluteTargetPath) {
                throw new Error('server.cannot_copy_to_self');
            }
            if (absoluteTargetPath.startsWith(absoluteSourcePath + path.sep)) {
                throw new Error('server.cannot_copy_to_subdirectory');
            }

            await fs.copy(absoluteSourcePath, absoluteTargetPath, { overwrite: true });
            return fileName;
        });

        await Promise.all(copyOperations);

        res.status(200).json({ message: 'server.copy_success' });
        // 通知前端刷新目标目录
        broadcastToInstance(instanceId, { type: 'file-change', instanceId, path: destination }, null, true);

    } catch (error) {
        handleFileError(res, error, 'server.copy_file_or_directory_failed');
    }
};

/**
 * 批量删除文件/目录。
 */
export const deleteMultipleFiles = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { filePaths } = req.body;
        if (!filePaths?.length) {
            return res.status(400).json({ message: 'server.missing_delete_paths' });
        }

        const instanceCwd = await fs.realpath(getInstanceRootPath(instanceId));
        const deleteOperations = filePaths.map(async (filePath) => {
            const absolutePath = await getFileAbsolutePath(instanceId, filePath);

            // 防止删除实例根目录
            if (absolutePath === instanceCwd) {
                console.warn(i18n.t('server.attempt_delete_instance_root_blocked', { relativePath: filePath }));
                return;
            }

            await fs.remove(absolutePath); // 删除文件或目录
        });

        await Promise.all(deleteOperations);

        res.status(200).json({ message: 'server.delete_success' });
        // 通知前端刷新受影响的目录
        const affectedDirs = new Set(filePaths.map(p => path.dirname(p)));
        affectedDirs.forEach(dir => broadcastToInstance(instanceId, { type: 'file-change', instanceId, path: dir }, null, true));

    } catch (error) {
        handleFileError(res, error, 'server.bulk_delete_failed');
    }
};

/**
 * 移动一个或多个文件/目录。
 */
export const moveFiles = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { files, destination } = req.body;
        if (!files?.length) {
            return res.status(400).json({ message: 'server.missing_move_details' });
        }

        const absoluteDestinationPath = await getFileAbsolutePath(instanceId, destination);

        const moveOperations = files.map(async (file) => {
            const absoluteSourcePath = await getFileAbsolutePath(instanceId, file);
            const fileName = path.basename(file);
            const absoluteTargetPath = await getFileAbsolutePath(instanceId, path.join(destination, fileName), { allowMissing: true });

            // 检查源路径和目标路径是否在同一个实例工作目录内（getFileAbsolutePath 已处理）
            // 检查是否尝试将文件移动到其自身，或其子目录
            if (absoluteSourcePath === absoluteTargetPath) {
                throw new Error('server.cannot_move_to_self');
            }
            if (absoluteTargetPath.startsWith(absoluteSourcePath + path.sep)) {
                throw new Error('server.cannot_move_to_subdirectory');
            }

            await fs.move(absoluteSourcePath, absoluteTargetPath, { overwrite: true });
            return fileName;
        });

        await Promise.all(moveOperations);

        res.status(200).json({ message: 'server.move_success' });
        // 通知前端刷新源目录和目标目录
        const sourceDirs = new Set(files.map(p => path.dirname(p)));
        sourceDirs.forEach(dir => broadcastToInstance(instanceId, { type: 'file-change', instanceId, path: dir }, null, true));
        broadcastToInstance(instanceId, { type: 'file-change', instanceId, path: destination }, null, true);

    } catch (error) {
        handleFileError(res, error, 'server.move_file_or_directory_failed');
    }
};
