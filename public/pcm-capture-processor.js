// Downsample mic to 8kHz Int16 frames (20ms => 160 samples)
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.muted = false;
    this.targetRate = 16000
    this.smooth = 0;        // one-pole de-ripple
    this.alpha  = 0.18;     // smoothing amount
    this.outBuf = new Int16Array(0);
    this.hold = 0;     // for simple LPF
    this.alpha = 0.2;  // LPF coefficient
    this.acc = 0;      // resample accumulator
    this.ratio = sampleRate / this.targetRate; // e.g., 48000/8000 = 6
    this.port.onmessage = (e) => {
      if (e.data?.cmd === 'mute') this.muted = !!e.data.value;
    };
  }

  _emitIfReady() {
    if (this.outBuf.length >= 160) {
      const payload = this.outBuf.slice(0, 160);
      this.outBuf = this.outBuf.slice(160);
      this.port.postMessage(payload, [payload.buffer]); // transfer
    }
  }

  process(inputs) {
    const chan = inputs[0]?.[0];
    if (!chan) return true;

    // simple low-pass + decimate
    for (let i = 0; i < chan.length; i++) {
      const x = chan[i];
      this.hold = this.hold + this.alpha * (x - this.hold); // 1-pole LPF
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;

        // to Int16
        let v = this.hold;
        if (v > 1) v = 1;
        if (v < -1) v = -1;
        const s = this.muted ? 0 : Math.round(v * 32767);

        // grow buffer in chunks
        const tmp = new Int16Array(this.outBuf.length + 1);
        tmp.set(this.outBuf, 0);
        tmp[this.outBuf.length] = s;
        this.outBuf = tmp;

        this._emitIfReady();
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
