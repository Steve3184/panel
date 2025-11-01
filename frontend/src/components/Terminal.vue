<template>
  <div ref="terminalContainer" style="height: 100%; width: 100%;"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useWebSocketStore } from '../stores/websocket';
import { useDebounceFn } from '@vueuse/core';

const props = defineProps({
  instanceId: {
    type: String,
    required: true
  },
  isReadOnly: {
    type: Boolean,
    default: false
  }
});

const terminalContainer = ref(null);
const websocketStore = useWebSocketStore();
let term = null;
let fitAddon = null;
let socket = null;

const resizeTerminal = useDebounceFn(() => {
  if (fitAddon) {
    fitAddon.fit();
  }
}, 100);

onMounted(() => {
  term = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000' },
    scrollback: 5000,
    readOnly: props.isReadOnly
  });
  
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalContainer.value);
  
  // Subscribe to WebSocket
  websocketStore.sendMessage({ type: 'subscribe', id: props.instanceId });
  socket = websocketStore.getSocket();
  if (socket) {
      socket.addEventListener('message', handleSocketMessage);
  }

  fitAddon.fit();
  window.addEventListener('resize', resizeTerminal);

  if (!props.isReadOnly) {
    term.onData(data => websocketStore.sendMessage({ type: 'input', id: props.instanceId, data }));
  }

  term.onResize(({ cols, rows }) => websocketStore.sendMessage({ type: 'resize', id: props.instanceId, cols, rows }));
});

onBeforeUnmount(() => {
  // Unsubscribe and clean up
  websocketStore.sendMessage({ type: 'unsubscribe', id: props.instanceId });
   if (socket) {
      socket.removeEventListener('message', handleSocketMessage);
  }
  window.removeEventListener('resize', resizeTerminal);
  if (term) {
    term.dispose();
  }
});

// Watch for instance ID changes to resubscribe
watch(() => props.instanceId, (newInstanceId, oldInstanceId) => {
    if (term) term.clear();
    websocketStore.sendMessage({ type: 'unsubscribe', id: oldInstanceId });
    websocketStore.sendMessage({ type: 'subscribe', id: newInstanceId });
});

function handleSocketMessage(event) {
    const msg = JSON.parse(event.data);
    if (msg.type === 'output' && msg.id === props.instanceId && term) {
        term.write(msg.data);
    }
}
</script>