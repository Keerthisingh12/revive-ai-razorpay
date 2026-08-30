/**
 * Seeded Pseudo-Random Number Generator (Mulberry32)
 * Deterministic — same seed always produces the same sequence.
 */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return {
    /** Returns a float in [0, 1) */
    next(): number {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Returns an integer in [min, max] inclusive */
    int(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    /** Returns a float in [min, max) */
    float(min: number, max: number): number {
      return this.next() * (max - min) + min;
    },
    /** Picks a random element from an array */
    pick<T>(arr: T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
    /** Returns true with probability p */
    bool(p: number): boolean {
      return this.next() < p;
    },
  };
}
