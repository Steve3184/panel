import os from 'os';

/**
 * 计算 Docker 容器的 CPU 使用率。
 * 参考: https://docs.docker.com/engine/api/v1.43/#tag/Container/get-ContainerStats
 * @param {object} stats 从 Docker API 获取的统计信息对象
 * @returns {string} CPU 使用率百分比，保留两位小数
 */
export function calculateCpuUsage(stats) {
    if (!stats || !stats.cpu_stats || !stats.precpu_stats) {
        return '0.00';
    }
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || os.cpus().length;

    if (systemDelta > 0 && cpuDelta > 0) {
        return ((cpuDelta / systemDelta) * numCpus * 100.0).toFixed(2);
    }
    return '0.00';
}

/**
 * 计算 Docker 容器的内存使用量。
 * @param {object} stats 从 Docker API 获取的统计信息对象
 * @returns {string} 内存使用量（MB），保留两位小数
 */
export function calculateMemoryUsage(stats) {
    if (!stats || !stats.memory_stats || !stats.memory_stats.usage) {
        return '0.00';
    }
    const usage = stats.memory_stats.usage;
    return (usage / (1024 * 1024)).toFixed(2);
}