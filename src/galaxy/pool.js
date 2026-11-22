// Splits a particle set over several workers. Each worker owns a contiguous slice and returns its positions
// (Float32, xyz) and a per-particle scalar (Float32) after every step; buffers are passed back and forth
// (transferred, not copied) so there is no per-frame allocation.
export class Pool {
  constructor(factory, count, n) {
    count = Math.max(1, Math.min(count, Math.ceil(n / 2000)));
    this.n = n;
    this.ranges = [];
    for (let k = 0; k < count; k++) this.ranges.push([Math.floor((n * k) / count), Math.floor((n * (k + 1)) / count)]);
    this.workers = this.ranges.map(() => factory());
    this.bufs = this.ranges.map(([a, b]) => ({ pos: new ArrayBuffer((b - a) * 12), val: new ArrayBuffer((b - a) * 4) }));
    this.busy = false;
    this.t = 0;
    this.extra = null;
  }

  // msgFor(k, start, end) -> [message, transferList]
  init(msgFor) {
    return Promise.all(this.workers.map((w, k) => new Promise((resolve, reject) => {
      w.onmessage = ({ data }) => { if (data.cmd === 'ready') resolve(data); };
      w.onerror = (e) => reject(e);
      const [msg, tr] = msgFor(k, ...this.ranges[k]);
      w.postMessage(msg, tr || []);
    })));
  }

  broadcast(msg) { this.workers.forEach((w) => w.postMessage(msg)); }

  // Ask every worker to advance by dt. onDone(pos, val, t, extra) is called per worker slice as results arrive
  // (start index first), then onAll() once every worker has answered.
  step(dt, onSlice, onAll) {
    if (this.busy) return false;
    this.busy = true;
    let left = this.workers.length;
    this.workers.forEach((w, k) => {
      w.onmessage = ({ data }) => {
        if (data.cmd !== 'step') return;
        this.bufs[k] = { pos: data.buf, val: data.frac };
        onSlice(this.ranges[k][0], new Float32Array(data.buf), new Float32Array(data.frac), data);
        if (--left === 0) { this.busy = false; this.t = data.t; onAll?.(data); }
      };
      const b = this.bufs[k];
      w.postMessage({ cmd: 'step', dt, buf: b.pos, frac: b.val }, [b.pos, b.val]);
    });
    return true;
  }

  terminate() { this.workers.forEach((w) => w.terminate()); }
}

// Takes the [start, end) part of every typed array in obj (non-arrays are copied as they are).
export function sliceArrays(obj, start, end, stride = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (ArrayBuffer.isView(v)) { const s = stride[k] ?? 1; out[k] = v.slice(start * s, end * s); }
    else out[k] = v;
  }
  out.n = end - start;
  return out;
}
