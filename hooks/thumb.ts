// The pure part of paste-thumb: tags, paths, sizes. No `$` here, so it runs in a plain test.

/** Longest side of a converted thumbnail, in pixels. */
export const SIDE = 480

/** The most rows a thumbnail takes, and the most cells wide it may get. */
export const ROWS = 10
export const MAX_COLUMNS = 48

/** The numbers of the `[Image #n]` tags in a draft, in order, each once. */
export function tokensOf(text: string): number[] {
  const seen = new Set<number>()
  for (const m of text.matchAll(/\[Image #(\d+)\]/g)) seen.add(Number(m[1]))

  return [...seen]
}

/** Claude Code names a pasted image `<n>.<ext>`. */
export function isPastedName(name: string, n: number): boolean {
  return new RegExp(`^${n}\\.[a-z0-9]+$`, 'i').test(name)
}

/** Claude Code's project folder for a cwd: every non-alphanumeric becomes `-`. */
export function projectFolder(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** `<tmp>/claude-<uid>`, where Claude Code keeps a session's pasted images. */
export function tempRoot(tmpdir: string | undefined, uid: string): string {
  return `${(tmpdir || '/tmp').replace(/\/+$/, '')}/claude-${uid}`
}

/**
 * Width and height of a PNG from `od -An -tu1 -N24 <file>`: the 8-byte signature, the IHDR chunk's
 * 4-byte length and its name, then width and height as 4 bytes each (bytes 16 to 23). Null for
 * anything that is not a PNG.
 */
export function parsePngSize(odOutput: string): { width: number; height: number } | null {
  const b = odOutput.trim().split(/\s+/).map(Number)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const ihdr = [73, 72, 68, 82]
  if (b.length < 24 || b.some(Number.isNaN)) return null
  if (!signature.every((v, i) => b[i] === v) || !ihdr.every((v, i) => b[12 + i] === v)) return null
  const width = b[16]! * 16777216 + b[17]! * 65536 + b[18]! * 256 + b[19]!
  const height = b[20]! * 16777216 + b[21]! * 65536 + b[22]! * 256 + b[23]!

  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * One converter call for a picture that is not a PNG: shrink its first frame to a PNG at `out` and
 * print the result's `width height`. The jpeg size hint makes a big photo decode at a fraction of
 * its size.
 */
export function thumbArgv(converter: string, src: string, out: string): string[] {
  return [
    converter,
    '-define', `jpeg:size=${SIDE * 2}x${SIDE * 2}`,
    `${src}[0]`,
    '-auto-orient',
    '-strip',
    '-thumbnail', `${SIDE}x${SIDE}>`,
    '-define', 'png:compression-level=1',
    '-write', `PNG32:${out}`,
    '-format', '%w %h',
    'info:',
  ]
}

/** `width height` as the converter printed it, or null. */
export function parseSize(stdout: string): { width: number; height: number } | null {
  const m = /^\s*(\d+) (\d+)\s*$/.exec(stdout)
  const width = m ? Number(m[1]) : 0
  const height = m ? Number(m[2]) : 0

  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * Cells for a picture `rows` tall, a cell being about twice as tall as wide. Where the room (or
 * MAX_COLUMNS, if that is less) is too narrow for it, the width is capped and the height shrinks
 * with it, so the proportions hold.
 */
export function boxFor(width: number, height: number, rows: number, room: number) {
  const cap = Math.min(room, MAX_COLUMNS)
  const natural = Math.max(2, Math.round((rows * 2 * width) / height))
  if (natural <= cap) return { columns: natural, rows }
  const columns = Math.max(2, cap)

  return { columns, rows: Math.max(1, Math.min(rows, Math.round((columns * height) / (2 * width)))) }
}
