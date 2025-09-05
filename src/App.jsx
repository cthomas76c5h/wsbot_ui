import { useEffect, useRef, useState } from 'react';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState('CLOSED');
  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const captureRef = useRef(null);
  const playerRef = useRef(null);
  const destRef = useRef(null);
  const audioElRef = useRef(null);

  // connect
  async function connect(wsUrl = 'ws://localhost:8081/ws') {
    if (connected) return;

    // AudioContext + worklets
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('/pcm-capture-processor.js');
    await ctx.audioWorklet.addModule('/pcm-player-processor.js');

    // Player worklet -> MediaStreamDestination -> <audio> (for setSinkId, volume, etc.)
    const player = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    const dest = ctx.createMediaStreamDestination();
    player.connect(dest);
    const audioEl = audioElRef.current;
    audioEl.srcObject = dest.stream;
    await audioEl.play();

    // Mic capture to worklet
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const mic = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 0 });

    mic.connect(capture);

    // WebSocket
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('OPEN');
      setConnected(true);
      // forward 20ms Int16 frames from capture worklet -> WS
      capture.port.onmessage = (e) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === 'string') {
        if (evt.data === 'STOP') {
          // flush player for clean barge-in
          player.port.postMessage({ cmd: 'flush' });
        }
        return;
      }
      // binary -> player worklet
      player.port.postMessage(evt.data, [evt.data]);
    };

    ws.onclose = () => {
      setStatus('CLOSED');
      setConnected(false);
      try { capture.port.onmessage = null; } catch {}
    };
    ws.onerror = () => setStatus('ERROR');

    // store refs
    wsRef.current = ws;
    ctxRef.current = ctx;
    captureRef.current = capture;
    playerRef.current = player;
    destRef.current = dest;
  }

  function disconnect() {
    try { wsRef.current?.close(); } catch {}
    try { ctxRef.current?.close(); } catch {}
    setConnected(false);
    setStatus('CLOSED');
  }

  function toggleMute() {
    const m = !muted;
    setMuted(m);
    captureRef.current?.port.postMessage({ cmd: 'mute', value: m });
  }

  useEffect(() => {
    // autoplay unlock on user gesture (click connect)
  }, []);

  return (
    <div style={{ fontFamily: 'Inter, system-ui', padding: 16 }}>
      <h3>Maya-ish Realtime Demo <span style={{ color: status === 'OPEN' ? 'green' : '#c66' }}>({status})</span></h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {!connected
          ? <button onClick={() => connect()}>Connect</button>
          : <button onClick={disconnect} style={{ background: '#f66', color: '#fff' }}>End call</button>}
        <button onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
      </div>

      <audio ref={audioElRef} autoPlay playsInline />
      <p style={{ opacity: 0.7 }}>• Duplex WS audio, 20 ms frames • Barge-in sends <code>STOP</code> to flush player</p>
    </div>
  );
}
