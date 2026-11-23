/** Intervalos semiabiertos [start, end) en milisegundos UTC. */
export type Interval = readonly [number, number];

export function normalize(list: Interval[]): Interval[] {
  const sorted = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** a − b */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const cut = normalize(b);
  const out: Interval[] = [];
  for (const [s0, e0] of normalize(a)) {
    let s = s0;
    for (const [bs, be] of cut) {
      if (be <= s || bs >= e0) continue;
      if (bs > s) out.push([s, bs]);
      s = Math.max(s, be);
      if (s >= e0) break;
    }
    if (s < e0) out.push([s, e0]);
  }
  return out;
}

/** a ∩ b */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const A = normalize(a);
  const B = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i]![0], B[j]![0]);
    const e = Math.min(A[i]![1], B[j]![1]);
    if (s < e) out.push([s, e]);
    if (A[i]![1] < B[j]![1]) i++;
    else j++;
  }
  return out;
}

export function contains(list: Interval[], [s, e]: Interval): boolean {
  return list.some(([ls, le]) => s >= ls && e <= le);
}

export function overlapsAny(list: Interval[], [s, e]: Interval): boolean {
  return list.some(([ls, le]) => s < le && e > ls);
}
