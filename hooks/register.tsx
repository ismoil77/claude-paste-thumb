import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Tile } from '../types'
import { ROWS, boxFor, isPastedName, parsePngSize, parseSize, projectFolder, tempRoot, thumbArgv, tokensOf } from './thumb'

const tiles = atom({ plugin: 'paste-thumb', key: 'tiles' } as const, [] as Tile[])

const POLL_MS = 500
const FIND_TRIES = 8

// The module's own memory: rebuilt after a reload, while `tiles` stays.
let pasteDir = ''
let work = ''
let converter: Promise<string> | null = null // looked for once a session; '' when there is none
let seen: string | null = null
const made = new Map<number, Tile>()
const pending = new Set<number>()

async function findConverter($: $): Promise<string> {
  const found = await $.process.run(['sh', '-c', 'command -v magick || command -v convert']).catch(() => null)
  const path = found?.stdout.trim().split('\n')[0] ?? ''
  if (path) await $.process.run(['mkdir', '-p', work]).catch(() => null)
  else $.ui.toast('paste-thumb: only PNG pictures show without ImageMagick (magick or convert)')

  return path
}

// Any other format is shrunk to a small PNG once, by ImageMagick: the only job that needs it.
async function convert($: $, n: number, src: string): Promise<Tile | null> {
  converter ??= findConverter($) // one lookup even when several pictures arrive together
  const tool = await converter
  if (!tool) return null
  const out = `${work}/${n}-${await $.clock.now()}.png`
  const done = await $.process.run(thumbArgv(tool, src, out), { timeoutMs: 20_000 }).catch(() => null)
  const size = done?.exitCode === 0 ? parseSize(done.stdout) : null

  return size ? { n, file: out, ...size } : null
}

// Claude Code stores a pasted image a moment after its tag shows. A PNG is read by the terminal
// itself, from where it lies: only its size is taken, from the header.
async function make($: $, n: number, attempt: number): Promise<void> {
  const entries = await $.fs.list(pasteDir).catch(() => [])
  const hit = entries.find(f => f.kind === 'file' && isPastedName(f.name, n))
  if (!hit) {
    if (attempt < FIND_TRIES) $.clock.after(250, () => void make($, n, attempt + 1))
    else pending.delete(n)

    return
  }
  const file = `${pasteDir}/${hit.name}`
  const head = await $.process.run(['od', '-An', '-tu1', '-N24', file]).catch(() => null)
  const png = head?.exitCode === 0 ? parsePngSize(head.stdout) : null
  const tile = png ? { n, file, ...png } : await convert($, n, file)
  pending.delete(n)
  if (!tile) return // its tag stays plain text
  made.set(n, tile)
  seen = null // the next poll draws it
}

// Pasting an image raises no prompt.edit, so the draft's tags are polled.
async function poll($: $) {
  const { text } = await $.prompt.read()
  const ns = tokensOf(text)
  const key = ns.join(',')
  if (key === seen) return
  seen = key
  // An empty draft: the tags were sent or deleted.
  if (ns.length === 0) made.clear()
  for (const n of ns) {
    if (!made.has(n) && !pending.has(n)) {
      pending.add(n)
      void make($, n, 0)
    }
  }
  await update($, tiles, () => ns.flatMap(n => made.get(n) ?? []))
}

async function findPasteDir($: $) {
  const uid = (await $.process.run(['id', '-u']).catch(() => null))?.stdout.trim() || '0'
  const sessionId = await $.session.id()
  const root = tempRoot(await $.env.get('CLAUDE_CODE_TMPDIR'), uid)

  // <root>/<project>/<session>/images, the project being the cwd with every non-alphanumeric as "-".
  let dir = `${root}/${projectFolder(await $.session.cwd())}/${sessionId}`
  if (!(await $.fs.exists(dir).catch(() => false))) {
    for (const entry of await $.fs.list(root).catch(() => [])) {
      const candidate = `${root}/${entry.name}/${sessionId}`
      if (entry.kind === 'dir' && (await $.fs.exists(candidate).catch(() => false))) dir = candidate
    }
  }

  work = `${((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')}/claude-paste-thumb/${sessionId.replace(/[^\w-]/g, '_')}`

  return `${dir}/images`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    converter = null
    pasteDir = await findPasteDir($)
    $.clock.every(POLL_MS, () => void poll($))

    return started
  })

  on('session.end', async ($, e, next) => {
    if (converter && (await converter)) await $.process.run(['rm', '-rf', work]).catch(() => null)
    made.clear()
    await update($, tiles, () => [])

    return next(e)
  })

  // The tags leave the draft on submit, so the next poll clears the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const list = await read($, tiles)
    if (list.length === 0) return next(e)

    const { Box, Text, Image } = $.ui.resolve(e)
    const rows = Math.max(2, Math.min(ROWS, e.props.maxRows - 3))
    const room = Math.floor((e.props.bodyColumns - list.length * 3) / list.length)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {list.map(t => {
            const box = boxFor(t.width, t.height, rows, room)

            return (
              <Box key={`tile-${t.n}`} flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
                <Image
                  key={`img-${t.n}`}
                  source={{ file: t.file, format: 'png' }}
                  columns={box.columns}
                  rows={box.rows}
                  alt={`[Image #${t.n}]`}
                />
                <Text dimColor>#{t.n}</Text>
              </Box>
            )
          })}
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
