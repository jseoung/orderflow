/**
 * Fixed-capacity circular ring buffer — O(1) push/read, no GC pressure
 */
class RingBuffer {
  constructor(capacity = 10000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;   // next write position
    this.size = 0;
  }

  push(item) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /** Get last N items (newest first if reverse=true) */
  last(n, reverse = false) {
    const count = Math.min(n, this.size);
    const result = [];
    for (let i = 1; i <= count; i++) {
      const idx = (this.head - i + this.capacity) % this.capacity;
      result.push(this.buffer[idx]);
    }
    return reverse ? result : result.reverse();
  }

  /** Drain all items since last drain (for batch processing) */
  drainSince(lastHead) {
    if (lastHead === this.head) return [];
    const items = [];
    let pos = lastHead;
    while (pos !== this.head) {
      if (this.buffer[pos] !== undefined) items.push(this.buffer[pos]);
      pos = (pos + 1) % this.capacity;
    }
    return items;
  }

  getHead() { return this.head; }
  getSize() { return this.size; }
  clear() { this.head = 0; this.size = 0; }
}

module.exports = { RingBuffer };
