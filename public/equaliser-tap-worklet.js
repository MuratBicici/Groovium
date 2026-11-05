/*
 * On the audio thread: the tab's sound, gathered into blocks of ten milliseconds
 * and handed to the worker that sends them. See src/platform/tabTap.ts.
 */

/** Ten milliseconds at 48 kHz, two channels side by side. */
const FRAMES = 480;

class EqualiserTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(FRAMES * 2);
    this.at = 0;
    this.out = null;
    this.port.onmessage = (event) => {
      this.out = event.data.port;
    };
  }

  process(inputs) {
    const input = inputs[0];
    const left = input[0];
    if (!left || !this.out) return true;
    const right = input[1] ?? left;
    for (let i = 0; i < left.length; i++) {
      this.block[this.at++] = left[i];
      this.block[this.at++] = right[i];
      if (this.at === this.block.length) {
        this.out.postMessage(this.block.buffer, [this.block.buffer]);
        this.block = new Float32Array(FRAMES * 2);
        this.at = 0;
      }
    }
    return true;
  }
}

registerProcessor('equaliser-tap', EqualiserTap);
