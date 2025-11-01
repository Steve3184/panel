import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Busboy from 'busboy';
import decompress from 'decompress';
import sevenBin from '7zip-bin';
import SevenZip from 'node-7z';
import archiver from 'archiver';
import decompressTar from '@xhmikosr/decompress-tar';
import decompressTarGz from '@xhmikosr/decompress-targz';
import decompressTarBz2 from '@xhmikosr/decompress-tarbz2';
import decompressTarXz from '@felipecrs/decompress-tarxz';

import { getFileAbsolutePath, activeUploads } from '../../core/fileManager.js';
import { UPLOAD_TEMP_DIR } from '../../config.js';
import { broadcast } from '../../websocket/handler.js';
import i18n from '../../utils/i18n.js';

const pathTo7zip = sevenBin.path7za;

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
        const absolutePath = getFileAbsolutePath(instanceId, relativePath);

        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ message: 'Path is not a directory.' });
        }

        const files = await fs.readdir(absolutePath);
        const fileDetails = await Promise.all(files.map(async file => {
            try {
                const filePath = path.join(absolutePath, file);
                const fileStats = await fs.stat(filePath);
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
        const absolutePath = getFileAbsolutePath(instanceId, relativePath);

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
        const absolutePath = getFileAbsolutePath(instanceId, relativePath);
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
        const absolutePath = getFileAbsolutePath(instanceId, newDirPath);

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
        const absolutePath = getFileAbsolutePath(instanceId, newFilePath);

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

        const absolutePath = getFileAbsolutePath(instanceId, relativePath);
        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);
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

        const oldAbsolutePath = getFileAbsolutePath(instanceId, oldPath);
        const newAbsolutePath = path.join(path.dirname(oldAbsolutePath), newName);

        // 额外的安全检查
        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);
        if (!newAbsolutePath.startsWith(instanceCwd)) {
            return res.status(403).json({ message: 'server.access_denied_outside' });
        }

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
        // 4GB 限制
        const MAX_FILE_SIZE = 16 * 1024 * 1024 * 1024;
        if (fileSize > MAX_FILE_SIZE) {
            return res.status(413).json({ message: 'server.file_size_exceeds_limit' });
        }

        const uploadId = uuidv4();
        const tempFilePath = path.join(UPLOAD_TEMP_DIR, uploadId);
        const targetPath = getFileAbsolutePath(instanceId, path.join(targetDirectory || '.', fileName));

        fs.ensureDirSync(path.dirname(targetPath));

        activeUploads.set(uploadId, {
            instanceId,
            fileName,
            fileSize,
            tempFilePath,
            targetPath,
            receivedSize: 0,
            writeStream: fs.createWriteStream(tempFilePath, { flags: 'w' }),
        });

        res.status(200).json({ uploadId, message: 'server.upload_initiated' });
    } catch (error) {
        handleFileError(res, error, 'server.failed_to_initiate_upload');
    }
};

/**
 * 使用 busboy 处理文件分块上传。
 */
export const uploadChunk = (req, res) => {
    const busboy = Busboy({ headers: req.headers });
    let uploadId, chunkIndex;

    busboy.on('field', (fieldname, val) => {
        if (fieldname === 'uploadId') uploadId = val;
        if (fieldname === 'chunkIndex') chunkIndex = parseInt(val, 10);
    });

    busboy.on('file', (fieldname, file) => {
        file.on('data', (data) => {
            const upload = activeUploads.get(uploadId);
            if (upload && upload.writeStream) {
                upload.writeStream.write(data);
                upload.receivedSize += data.length;
            }
        });
        file.on('end', () => {
            const upload = activeUploads.get(uploadId);
            res.status(200).json({ message: 'server.ok', receivedSize: upload?.receivedSize || 0 });
        });
    });

    busboy.on('error', (err) => {
        res.status(500).json({ message: 'File upload parsing error', error: err.message });
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

        if (!upload) {
            return res.status(404).json({ message: 'server.upload_not_found_or_expired' });
        }

        // 关闭写文件流
        upload.writeStream.end();

        // 验证文件大小是否匹配
        if (upload.receivedSize !== upload.fileSize) {
            await fs.remove(upload.tempFilePath); // 清理不完整的文件
            activeUploads.delete(uploadId);
            return res.status(400).json({ message: 'server.not_all_chunks_received' });
        }

        // 移动文件
        await fs.move(upload.tempFilePath, upload.targetPath, { overwrite: true });

        // 清理
        activeUploads.delete(uploadId);

        const relativeFilePath = path.relative(req.instanceConfig.cwd, upload.targetPath);
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
        const absoluteFilePath = getFileAbsolutePath(instanceId, filePath);
        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destinationPath || path.dirname(filePath));
        await fs.ensureDir(absoluteDestinationPath);

        const extractId = uuidv4();
        const fileExtension = path.extname(filePath).toLowerCase();
        const baseName = path.basename(filePath);
        res.status(202).json({ message: 'server.file_extract_request_accepted', extractId });

        // --- 后台处理逻辑 ---
        (async () => {
            const sendProgress = (progress) => {
                broadcast({
                    type: 'file-extract-progress',
                    extractId: extractId,
                    fileName: baseName,
                    status: 'in-progress',
                    progress: progress // 0-100
                });
            };

            const sendCompletion = (status, message) => {
                broadcast({
                    type: 'file-extract-status',
                    extractId: extractId,
                    fileName: baseName,
                    status: status,
                    message: message
                });
                if (status === 'success') {
                    broadcast({
                        type: 'file-change',
                        instanceId: instanceId,
                        path: destinationPath || path.dirname(filePath),
                    });
                }
            };

            try {
                if (fileExtension === '.7z' || fileExtension === '.zip') {
                    const sevenZStream = SevenZip.extractFull(absoluteFilePath, absoluteDestinationPath, {
                        $progress: true,
                        $bin: pathTo7zip
                    });

                    let lastProgress = -1;
                    sevenZStream.on('progress', (progress) => {
                        if (lastProgress < progress.percent) {
                            sendProgress(progress.percent);
                            lastProgress = progress.percent;
                        }
                    });

                    sevenZStream.on('end', () => {
                        console.log(i18n.t('server.file_extracted_success_log', { filePath: filePath, absoluteDestinationPath: absoluteDestinationPath }));
                        sendCompletion('success', 'server.file_extracted_success');
                    });

                    sevenZStream.on('error', (err) => {
                        console.error(i18n.t('server.file_extract_failed_log', { filePath: filePath }), err);
                        sendCompletion('error', 'server.file_extract_failed');
                    });

                } else if (filePath.toLowerCase().endsWith('.tar.gz') || filePath.toLowerCase().endsWith('.tgz') || filePath.toLowerCase().endsWith('.tar.xz') || filePath.toLowerCase().endsWith('.tar')) {
                    // decompress 库支持多种 tar 格式
                    // decompress 库本身不直接提供进度事件，需要通过文件数量来模拟
                    const files = await decompress(absoluteFilePath, absoluteDestinationPath, {
                        plugins: [
                            decompressTar(),
                            decompressTarGz(),
                            decompressTarBz2(), // 如果需要支持 .tar.bz2
                            decompressTarXz() // 如果需要支持 .tar.xz
                        ]
                    });

                    // 模拟进度：假设解压文件数量可以作为进度指标
                    // 这是一个简化的进度，实际可能需要更复杂的逻辑
                    let extractedCount = 0;
                    const totalFiles = files.length; // decompress 返回解压的文件列表

                    if (totalFiles === 0) {
                        sendProgress(100); // 如果没有文件，直接完成
                    } else {
                        files.forEach((file, index) => {
                            extractedCount++;
                            sendProgress(Math.round((extractedCount / totalFiles) * 100));
                        });
                    }

                    console.log(i18n.t('server.file_extracted_success_log', { filePath: filePath, absoluteDestinationPath: absoluteDestinationPath }));
                    sendCompletion('success', 'server.file_extracted_success');

                } else {
                    return res.status(400).json({ message: 'server.unsupported_archive_type' });
                }

            } catch (error) {
                if (error.message.includes('Instance not found')) {
                    sendCompletion('error', 'server.instance_not_found');
                    return res.status(404).json({ message: 'server.instance_not_found' });
                }
                if (error.message.includes('Access denied')) {
                    sendCompletion('error', 'server.no_perms');
                    return res.status(403).json({ message: 'server.access_denied_outside' });
                }
                if (error.code === 'ENOENT') {
                    sendCompletion('error', 'server.file_or_directory_not_found_error');
                    return res.status(404).json({ message: 'server.file_or_directory_not_found' });
                }
                console.error('server.extract_api_internal_error_log', error);
                sendCompletion('error', 'server.extract_api_internal_error');
                // 如果在 exec 之前发生错误，仍然需要发送 HTTP 响应
                if (!res.headersSent) {
                    res.status(500).json({ message: 'server.extract_api_internal_error', error: error.message });
                }
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
        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destinationPath || '');
        const absoluteOutputFilePath = path.join(absoluteDestinationPath, outputName);

        const filesToCompressAbsolutePaths = filesToCompress.map(file => getFileAbsolutePath(instanceId, file));

        const compressId = uuidv4();
        res.status(202).json({ message: 'server.file_compress_request_accepted', compressId });

        // --- 后台处理逻辑 ---
        (async () => {
            const sendProgress = (progress) => {
                broadcast({
                    type: 'file-compress-progress',
                    compressId: compressId,
                    outputName: outputName,
                    status: 'in-progress',
                    progress: progress // 0-100
                });
            };

            const sendCompletion = (status, message) => {
                broadcast({
                    type: 'file-compress-status',
                    compressId: compressId,
                    outputName: outputName,
                    status: status,
                    message: message
                });
                if (status === 'success') {
                    broadcast({
                        type: 'file-change',
                        instanceId: instanceId,
                        path: destinationPath || ''
                    });
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
                        const archive = archiver('tar', {
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
                        const archive = archiver('tar'); // 创建 tar 归档，不进行 gzip 压缩

                        const outputStream = fs.createWriteStream(absoluteOutputFilePath);
                        const xzProcess = require('child_process').spawn('xz', ['-z', '-T0', `-`]); // -T0 使用所有可用核心，-z 压缩，-c 输出到 stdout

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
        if (!files?.length || !destination) {
            return res.status(400).json({ message: 'server.missing_copy_details' });
        }

        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destination);
        await fs.ensureDir(absoluteDestinationPath);

        const copyOperations = files.map(async (file) => {
            const absoluteSourcePath = getFileAbsolutePath(instanceId, file);
            const fileName = path.basename(file);
            const absoluteTargetPath = path.join(absoluteDestinationPath, fileName);

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
        broadcast({ type: 'file-change', instanceId, path: destination });

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

        const instanceCwd = req.instanceConfig.cwd || path.join(WORKSPACES_PATH, instanceId);
        const deleteOperations = filePaths.map(async (filePath) => {
            const absolutePath = getFileAbsolutePath(instanceId, filePath);

            // 防止删除实例根目录
            if (absolutePath === instanceCwd) {
                console.warn(i18n.t('server.attempt_delete_instance_root_blocked', { relativePath: filePath }));
                return;
            }

            await fs.remove(absolutePath); // 删除文件或目录
            deletedItems.push(relativePath);

        });

        await Promise.all(deleteOperations);

        res.status(200).json({ message: 'server.delete_success' });
        // 通知前端刷新受影响的目录
        const affectedDirs = new Set(filePaths.map(p => path.dirname(p)));
        affectedDirs.forEach(dir => broadcast({ type: 'file-change', instanceId, path: dir }));

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
        if (!files?.length || !destination) {
            return res.status(400).json({ message: 'server.missing_move_details' });
        }

        const absoluteDestinationPath = getFileAbsolutePath(instanceId, destination);

        const moveOperations = files.map(async (file) => {
            const absoluteSourcePath = getFileAbsolutePath(instanceId, file);
            const fileName = path.basename(file);
            const absoluteTargetPath = path.join(absoluteDestinationPath, fileName);

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
        sourceDirs.forEach(dir => broadcast({ type: 'file-change', instanceId, path: dir }));
        broadcast({ type: 'file-change', instanceId, path: destination });

    } catch (error) {
        handleFileError(res, error, 'server.move_file_or_directory_failed');
    }
};