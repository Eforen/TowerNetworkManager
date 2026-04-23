/**
 * `portLayout` on server / switch / router: space-separated media specs like
 * `RJ45[2] FIBER RJ45[3] FIBER[2]`, matching fileformat port declarations.
 */

export type PortLayoutMedia = 'RJ45' | 'FiberOptic';

const LAYOUT_ALIASES: Record<string, PortLayoutMedia> = {
  rj45: 'RJ45',
  rj: 'RJ45',
  fiberoptic: 'FiberOptic',
  fiber: 'FiberOptic',
  f: 'FiberOptic',
  fib: 'FiberOptic',
};

/** `RJ45[2]`, `FIBER`, `F[3]` (longer keywords before `F` / `RJ`). */
const LAYOUT_TOKEN =
  /^((?:FiberOptic|FIBER|RJ45|Fiber|RJ|F))(?:\[(\d+)\])?$/i;

export function isPortLayoutToken(tok: string): boolean {
  const t = tok.trim();
  if (!t || t.includes('=')) return false;
  const m = LAYOUT_TOKEN.exec(t);
  if (!m) return false;
  const key = m[1].toLowerCase();
  return (LAYOUT_ALIASES as Record<string, PortLayoutMedia>)[key] !== undefined;
}

export function expandPortLayoutToMediaList(spec: string): PortLayoutMedia[] {
  const s = spec.trim();
  if (s.length === 0) return [];
  const parts = s.split(/\s+/).filter((p) => p.length > 0);
  const out: PortLayoutMedia[] = [];
  for (const p of parts) {
    if (p.includes('=')) {
      throw new Error(`portLayout: unexpected key=value in layout segment: ${p}`);
    }
    const m = LAYOUT_TOKEN.exec(p);
    if (!m) {
      throw new Error(`portLayout: unknown or invalid media token: ${p}`);
    }
    const media = (LAYOUT_ALIASES as Record<string, PortLayoutMedia>)[
      m[1].toLowerCase()
    ];
    if (!media) {
      throw new Error(`portLayout: unknown media: ${m[1]}`);
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    if (count < 1 || count > 100) {
      throw new Error(`portLayout: count in ${p} must be 1..100`);
    }
    for (let k = 0; k < count; k++) out.push(media);
  }
  return out;
}

/**
 * Compress a media list into `RJ45[2] FIBER ...` (runs of identical media
 * become bracketed counts).
 */
export function compressPortLayoutString(m: readonly PortLayoutMedia[]): string {
  if (m.length === 0) return '';
  const parts: string[] = [];
  let i = 0;
  while (i < m.length) {
    const cur = m[i];
    let c = 0;
    let j = i;
    while (j < m.length && m[j] === cur) {
      c++;
      j++;
    }
    i = j;
    const w = cur === 'RJ45' ? 'RJ45' : 'FIBER';
    parts.push(c === 1 ? w : `${w}[${c}]`);
  }
  return parts.join(' ');
}
