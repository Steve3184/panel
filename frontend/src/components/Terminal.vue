<template>
  <div ref="terminalWrapper" class="terminal-wrapper">
    <div ref="terminalContainer" class="terminal-pane"></div>

    <!-- Virtual key bar: touch devices only, not shown in read-only mode.
         Modifier keys (Ctrl/Alt) support three states:
           off     → single click → active (fires once, auto-releases after next input)
           active  → single click → off   (cancel before typing)
           off     → double click → held  (stays pressed until clicked again)
           held    → single click → off -->
    <div v-if="isTouchDevice && !isReadOnly" class="vk-bar" @touchstart.stop @mousedown.prevent>
      <!-- Direct keys -->
      <button class="vk-key" @click="sendKey('\x1b')" title="Esc">Esc</button>
      <button class="vk-key" @click="sendKey('\t')" title="Tab">Tab</button>
      <div class="vk-sep"></div>
      <button class="vk-key" @click="sendKey('\x1b[A')" title="↑">↑</button>
      <button class="vk-key" @click="sendKey('\x1b[B')" title="↓">↓</button>
      <button class="vk-key" @click="sendKey('\x1b[D')" title="←">←</button>
      <button class="vk-key" @click="sendKey('\x1b[C')" title="→">→</button>
      <div class="vk-sep"></div>
      <!-- Sticky modifier keys -->
      <button
        :class="['vk-key', 'vk-mod', `vk-mod--${ctrlState}`]"
        @click="handleModifierClick('ctrl')"
        title="Ctrl">
        Ctrl
        <span v-if="ctrlState !== 'off'" class="vk-mod-dot"></span>
      </button>
      <button
        :class="['vk-key', 'vk-mod', `vk-mod--${altState}`]"
        @click="handleModifierClick('alt')"
        title="Alt">
        Alt
        <span v-if="altState !== 'off'" class="vk-mod-dot"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useWebSocketStore } from '../stores/websocket';
import { useDebounceFn } from '@vueuse/core';

const props = defineProps({
    instanceId: { type: String, required: true },
    isReadOnly: { type: Boolean, default: false }
});

const emit = defineEmits(['has-content']);

const terminalWrapper = ref(null);
const terminalContainer = ref(null);
const websocketStore = useWebSocketStore();

const isTouchDevice = ref(false);

let term = null;
let fitAddon = null;
let socket = null;
let vpResizeCleanup = null;

// ─── Modifier key state ───────────────────────────────────────────────────────
// 'off' | 'active' (fires once then auto-releases) | 'held' (locked until clicked)

const ctrlState = ref('off');
const altState  = ref('off');

// Double-click detection: two clicks within 300 ms → held mode.
const modTimers = { ctrl: null, alt: null };

const handleModifierClick = (mod) => {
    const stateRef = mod === 'ctrl' ? ctrlState : altState;

    if (modTimers[mod] !== null) {
        // Second tap within 300 ms → double-click → locked hold
        clearTimeout(modTimers[mod]);
        modTimers[mod] = null;
        stateRef.value = 'held';
    } else {
        modTimers[mod] = setTimeout(() => {
            modTimers[mod] = null;
            // Single tap: off→active, anything else→off
            stateRef.value = stateRef.value === 'off' ? 'active' : 'off';
        }, 300);
    }
};

/**
 * Apply the current modifier state to a raw data string.
 * After applying, auto-release any 'active' modifiers.
 * 'held' modifiers are NOT released.
 */
const applyModifiers = (data) => {
    let result = data;

    if (ctrlState.value !== 'off' && data.length === 1) {
        const code = data.charCodeAt(0);
        if (code >= 64 && code <= 95) {
            // @ A-Z [ \ ] ^ _ → Ctrl+@ through Ctrl+_  (\x00–\x1f)
            result = String.fromCharCode(code - 64);
        } else if (code >= 97 && code <= 122) {
            // a-z → Ctrl+a–z (\x01–\x1a)
            result = String.fromCharCode(code - 96);
        }
        // digits / symbols: no well-defined Ctrl mapping, pass through unchanged
        if (ctrlState.value === 'active') ctrlState.value = 'off';
    }

    if (altState.value !== 'off') {
        result = '\x1b' + result;
        if (altState.value === 'active') altState.value = 'off';
    }

    return result;
};

// ─── Virtual key send ─────────────────────────────────────────────────────────

const sendKey = (sequence) => {
    if (!term || props.isReadOnly) return;
    const data = applyModifiers(sequence);
    websocketStore.sendMessage({ type: 'input', id: props.instanceId, data });
    term.focus();
};

// ─── Resize helpers ───────────────────────────────────────────────────────────

const resizeTerminal = useDebounceFn(() => {
    if (fitAddon) fitAddon.fit();
}, 100);

const triggerResize = () => {
    if (fitAddon) fitAddon.fit();
    if (term) {
        websocketStore.sendMessage({ type: 'resize', id: props.instanceId, cols: term.cols, rows: term.rows });
    }
};

defineExpose({ triggerResize });

const setupVisualViewport = () => {
    if (!window.visualViewport) return;
    const onVpResize = () => resizeTerminal();
    window.visualViewport.addEventListener('resize', onVpResize);
    vpResizeCleanup = () => window.visualViewport.removeEventListener('resize', onVpResize);
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
    isTouchDevice.value = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;

    term = new Terminal({
        cursorBlink: true,
        theme: { background: '#000000' },
        scrollback: 5000,
        readOnly: props.isReadOnly,
        fontSize: isTouchDevice.value ? 13 : 15,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new ClipboardAddon());
    term.loadAddon(new WebLinksAddon());
    term.open(terminalContainer.value);

    websocketStore.sendMessage({ type: 'subscribe', id: props.instanceId });
    socket = websocketStore.getSocket();
    if (socket) socket.addEventListener('message', handleSocketMessage);

    fitAddon.fit();
    window.addEventListener('resize', resizeTerminal);
    setupVisualViewport();

    if (!props.isReadOnly) {
        // Intercept all typed input so active/held modifiers are applied before sending.
        term.onData(data => {
            const modified = applyModifiers(data);
            websocketStore.sendMessage({ type: 'input', id: props.instanceId, data: modified });
        });
    }

    term.onResize(({ cols, rows }) =>
        websocketStore.sendMessage({ type: 'resize', id: props.instanceId, cols, rows })
    );
});

onBeforeUnmount(() => {
    // Cancel any pending double-click timers
    Object.keys(modTimers).forEach(k => { if (modTimers[k]) clearTimeout(modTimers[k]); });
    websocketStore.sendMessage({ type: 'unsubscribe', id: props.instanceId });
    if (socket) socket.removeEventListener('message', handleSocketMessage);
    window.removeEventListener('resize', resizeTerminal);
    vpResizeCleanup?.();
    if (term) term.dispose();
});

watch(() => props.instanceId, (newId, oldId) => {
    if (term) term.clear();
    ctrlState.value = 'off';
    altState.value = 'off';
    websocketStore.sendMessage({ type: 'unsubscribe', id: oldId });
    websocketStore.sendMessage({ type: 'subscribe', id: newId });
});

function handleSocketMessage(event) {
    const msg = JSON.parse(event.data);
    if (msg.type === 'output' && msg.id === props.instanceId && term) {
        if (msg.data?.length > 0) emit('has-content');
        term.write(msg.data);
    }
}
</script>

<style scoped>
.terminal-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
}

.terminal-pane {
    flex: 1;
    min-height: 0;
}

/* ─── Virtual key bar ───────────────────────────────────────────────── */
.vk-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: #111;
    border-top: 1px solid #333;
    overflow-x: auto;
    flex-shrink: 0;
    scrollbar-width: none;
}
.vk-bar::-webkit-scrollbar { display: none; }

.vk-key {
    flex-shrink: 0;
    padding: 4px 10px;
    min-width: 36px;
    border: 1px solid #444;
    border-radius: 4px;
    background: #222;
    color: #ccc;
    font-size: 0.78rem;
    font-family: monospace;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    line-height: 1.4;
    text-align: center;
    position: relative;
}
.vk-key:active {
    background: #444;
    color: #fff;
}

/* ─── Modifier key states ───────────────────────────────────────────── */

/* active: one-shot, will fire once then release */
.vk-mod--active {
    background: #1a3a6a;
    border-color: #4a90d9;
    color: #90c8ff;
}
.vk-mod--active:active {
    background: #2a4a7a;
}

/* held: locked on until clicked again */
.vk-mod--held {
    background: #0d5c2e;
    border-color: #2ecc71;
    color: #7fffb0;
}
.vk-mod--held:active {
    background: #1a7a40;
}

/* indicator dot shown in top-right corner when modifier is on */
.vk-mod-dot {
    position: absolute;
    top: 2px;
    right: 3px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.8;
}

/* Visual separator between key groups */
.vk-sep {
    width: 1px;
    height: 20px;
    background: #444;
    flex-shrink: 0;
    margin: 0 2px;
}
</style>
