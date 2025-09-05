// Upsample 8kHz Int16 frames to ctx.sampleRate and play smoothly.
// Maintains a float queue; supports STOP/flush.
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; // array of Float32Array chunks
    this.qLen = 0;   // total samples queued
    this.srcRate = 8000;
    this.dstRate = sampleRate; // e.g., 48000
    this.up = this.dstRate / this.srcRate; // 6.0 if 48k->8k
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg?.cmd === 'flush') {
        this.queue = [];
        this.qLen = 0;
        return;
      }
      if (msg instanceof ArrayBuffer) {
        this._enqueue(new Int16Array(msg));
      } else if (msg?.buffer instanceof ArrayBuffer && msg.BYTES_PER_ELEMENT === 2) {
        this._enqueue(new Int16Array(msg.buffer));
      } else if (msg instanceof Int16Array) {
        this._enqueue(msg);
      }
    };
  }

  _enqueue(int16) {
    // convert to float32 then simple linear upsample to dstRate
    const n = int16.length;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = Math.max(-1, Math.min(1, int16[i] / 32768));

    const outN = Math.ceil(n * this.up);
    const out = new Float32Array(outN);
    for (let i = 0; i < outN; i++) {
      const t = i / this.up;       // position in src
      const i0 = Math.floor(t);
      const i1 = Math.min(i0 + 1, n - 1);
      const frac = t - i0;
      out[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }

    this.queue.push(out);
    this.qLen += out.length;
  }

  process(_, outputs) {
    const out = outputs[0][0]; // mono
    let i = 0;

    while (i < out.length) {
      if (this.queue.length === 0) {
        // underrun -> play silence
        out[i++] = 0;
        continue;
      }
      const head = this.queue[0];
      const need = out.length - i;
      const take = Math.min(need, head.length);

      out.set(head.subarray(0, take), i);
      i += take;

      if (take === head.length) {
        this.queue.shift();
      } else {
        this.queue[0] = head.subarray(take);
      }
      this.qLen -= take;
    }

    return true;
  }
}

registerProcessor('pcm-player', PcmPlayerProcessor);
