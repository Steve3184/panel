import { spawn } from 'child_process';
import { chmod, stat, writeFile } from 'fs/promises';
import { platform, arch as _arch, EOL } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const VERSION = "0.2";
function getMachine() {
    let machine = _arch();
    if (machine === 'x64') {
        return 'amd64';
    }
    return machine;
}

const BINARY_REMOTE_NAME = `frpc_${platform()}_${getMachine().toLowerCase()}`;
const EXTENSION = platform() === 'win32' ? '.exe' : '';
const BINARY_URL = `https://cdn-media.huggingface.co/frpc-gradio-${VERSION}/${BINARY_REMOTE_NAME}${EXTENSION}`;
const BINARY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), `${BINARY_REMOTE_NAME}_v${VERSION}`);

const TUNNEL_TIMEOUT_SECONDS = 30;
const TUNNEL_ERROR_MESSAGE = "tunnel error: ";
const GRADIO_API_SERVER = "https://api.gradio.app/v2/tunnel-request";

class Tunnel {
    constructor(remote_host, remote_port, local_host, local_port, share_token) {
        this.proc = null;
        this.url = null;
        this.remote_host = remote_host;
        this.remote_port = remote_port;
        this.local_host = local_host;
        this.local_port = local_port;
        this.share_token = share_token;
    }

    static async downloadBinary() {
        try {
            await stat(BINARY_PATH);
            return;
        } catch (error) {
        }

        const resp = await fetch(BINARY_URL);

        if (resp.status === 403) {
            throw new Error(`platform not supported`);
        }

        if (!resp.ok) {
            throw new Error(`failed to download frpc: ${resp.statusText}`);
        }

        const data = await resp.arrayBuffer();
        await writeFile(BINARY_PATH, Buffer.from(data));
        if (platform() !== 'win32') {
            await chmod(BINARY_PATH, '755');
        }
    }

    async startTunnel() {
        await Tunnel.downloadBinary();
        this.url = await this._startTunnel(BINARY_PATH);
        return this.url;
    }

    kill() {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
        }
    }

    async restartTunnel() {
        this.kill();
        this.url = await this._startTunnel(BINARY_PATH);
        return this.url;
    }

    _startTunnel(binary) {
        return new Promise(async (resolve, reject) => {
            const command = [
                'http',
                '-n', this.share_token,
                '-l', this.local_port.toString(),
                '-i', this.local_host,
                '--uc',
                '--sd', this.share_token,
                '--ue',
                '--server_addr', `${this.remote_host}:${this.remote_port}`,
                '--disable_log_color',
            ];

            if (this.isRandomToken) {
                const sdIndex = command.indexOf('--sd');
                command.splice(sdIndex, 2, '--sd', 'random');
            }

            this.proc = spawn(binary, command);

            process.on('exit', () => this.kill());
            process.on('SIGINT', () => process.exit());
            process.on('SIGTERM', () => process.exit());

            const log = [];
            let url = "";

            const timeout = setTimeout(() => {
                this.proc.kill();
                const logText = log.join(EOL);
                reject(new Error(`${TUNNEL_ERROR_MESSAGE}${EOL}${logText}`));
            }, TUNNEL_TIMEOUT_SECONDS * 1000);

            const onData = (data) => {
                const line = data.toString();
                log.push(line.trim());

                if (line.includes("start proxy success")) {
                    const result = /start proxy success: (.+)/.exec(line);
                    if (result && result[1]) {
                        url = result[1].trim();
                        clearTimeout(timeout);
                        this.proc.stdout.removeListener('data', onData);
                        this.proc.stderr.removeListener('data', onData);
                        resolve(url);
                    }
                } else if (line.includes("login to server failed")) {
                    clearTimeout(timeout);
                    const logText = log.join(EOL);
                    reject(new Error(`${TUNNEL_ERROR_MESSAGE}${EOL}${logText}`));
                }
            };

            this.proc.stdout.on('data', onData);
            this.proc.stderr.on('data', onData);

            this.proc.on('close', (code) => {
                if (url === "") {
                    clearTimeout(timeout);
                    reject(new Error(`frpc exited with code: ${code}`));
                }
                // 隧道意外关闭，尝试重启
                console.error(`\ntunnel exited: ${code}, restarting in 30s...`);
                setTimeout(() => this.restartTunnel(), 30 * 1000);
            });
        });
    }
}

async function setupTunnel(local_host, local_port, share_token) {
    try {
        const response = await fetch(GRADIO_API_SERVER);
        if (!response.ok) {
            throw new Error("failed to fetch Gradio API config");
        }
        const payload = (await response.json())[0];
        const { host: remote_host, port: remote_port } = payload;

        const tunnel = new Tunnel(remote_host, remote_port, local_host, local_port, share_token);
        if (share_token.startsWith('random_')) {
            tunnel.isRandomToken = true;
        }
        await tunnel.startTunnel();

        // 每 72 小时刷新一次隧道
        setInterval(() => tunnel.restartTunnel(), 72 * 60 * 60 * 1000);

        return tunnel;
    } catch (e) {
        setTimeout(() => {setupTunnel(local_host, local_port, share_token)}, 15 * 1000);
    }
}

function getRandomToken() {
    return `random_${randomBytes(16).toString('hex')}`;
}

export { Tunnel, setupTunnel, getRandomToken };