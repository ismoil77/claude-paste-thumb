import { atom, read, update } from 'claude-code'
import type { EngineInterface as $, Register } from 'claude-code'

import type { Tile } from '../types'
import { ROWS, boxFor, isPastedName, parsePngSize, parseSize, projectFolder, tempRoot, thumbArgv, tokensOf } from './thumb'

const tiles = atom({ plugin: 'paste-thumb', key: 'tiles' } as const, [] as Tile[])

const POLL_MS = 500
// A tag gets this many polls to show its file: about ten seconds.
const MAX_TRIES = 20

// The module's own memory. A reload resets it and drops the poll timer (`tiles` stays); session.start
// then runs again and re-arms the poll. Everything that depends on the session is derived again
// whenever the session's id changes, because `/clear` and a resume keep the process and raise no
// session.start.
let sid = ''
let pasteDir = ''
let work = ''
let converter: Promise<string> | null = null // looked for once a session; '' when there is none
let stop: (() => void) | null = null
let polling = false
let warned = false
let shown: string | null = null // the tiles last handed to the band, null: nothing yet, so the next poll writes
let epoch = 0 // bumped whenever what was read no longer applies, so a late result is dropped
const made = new Map<number, Tile>()
const pending = new Set<number>()
const tries = new Map<number, number>()

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function forget() {
  epoch += 1
  made.clear()
  pending.clear()
  tries.clear()
  converter = null
  warned = false
  shown = null
}

async function findConverter($: $): Promise<string> {
  const found = await $.process.run(['sh', '-c', 'command -v magick || command -v convert']).catch(() => null)
  const path = found?.stdout.trim().split('\n')[0] ?? ''
  if (!path) {
    $.ui.toast('paste-thumb: only PNG pictures show without ImageMagick (magick or convert)')

    return ''
  }
  const dir = await $.process.run(['mkdir', '-p', work]).catch(() => null)
  if (dir?.exitCode !== 0) {
    $.ui.toast(`paste-thumb: cannot create ${work}`)

    return ''
  }

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
  if (!size) {
    const why = done ? `exit ${done.exitCode}: ${done.stderr.slice(0, 200)}` : 'did not run or timed out'
    $.ui.log(`paste-thumb: could not convert Image #${n} (${why})`, { to: 'debug' })
  }

  return size ? { n, file: out, ...size } : null
}

// One try at a tag. The pasted file may land after its tag shows, so a try that finds no file, or one
// still being written, is repeated by the next poll, up to MAX_TRIES times. A PNG is read by the
// terminal itself, from where it lies: only its size is taken, from the header.
async function attempt($: $, n: number, at: number) {
  const entries = await $.fs.list(pasteDir).catch(() => [])
  const hit = entries.find(f => f.kind === 'file' && isPastedName(f.name, n))
  if (hit && hit.size >= 24) {
    const file = `${pasteDir}/${hit.name}`
    const head = await $.process.run(['od', '-An', '-tu1', '-N24', file]).catch(() => null)
    const png = head?.exitCode === 0 ? parsePngSize(head.stdout) : null
    const tile = png ? { n, file, ...png } : await convert($, n, file)
    if (tile && at === epoch) {
      made.set(n, tile)
      tries.delete(n)
    } else if (!tile && at === epoch) {
      // the file is there and would not convert (or is still being written): a few more tries, not the whole budget
      tries.set(n, Math.max(tries.get(n) ?? 0, MAX_TRIES - 3))
    }
  }
  if (at !== epoch) return
  pending.delete(n)
  if (!made.has(n) && (tries.get(n) ?? 0) >= MAX_TRIES && !warned) {
    warned = true
    $.ui.log(`paste-thumb: no readable ${n}.* in ${pasteDir} after ${MAX_TRIES} tries`, { to: 'debug' })
    $.ui.toast(`paste-thumb: cannot find pasted Image #${n} in ${pasteDir}`)
  }
}

// <root>/<project>/<session>/images, the project being the cwd with every non-alphanumeric as "-".
async function locate($: $, id: string) {
  const uid = (await $.process.run(['id', '-u']).catch(() => null))?.stdout.trim() || '0'
  const root = tempRoot(await $.env.get('CLAUDE_CODE_TMPDIR'), uid)
  let dir = `${root}/${projectFolder(await $.session.cwd())}/${id}`
  if (!(await $.fs.exists(dir).catch(() => false))) {
    for (const entry of await $.fs.list(root).catch(() => [])) {
      const candidate = `${root}/${entry.name}/${id}`
      if (entry.kind === 'dir' && (await $.fs.exists(candidate).catch(() => false))) dir = candidate
    }
  }
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')

  return { pasteDir: `${dir}/images`, work: `${tmp}/claude-paste-thumb/${id.replace(/[^\w-]/g, '_')}` }
}

async function switchSession($: $, id: string) {
  const old = work
  forget()
  sid = id
  ;({ pasteDir, work } = await locate($, id))
  if (old && old !== work) await $.process.run(['rm', '-rf', old]).catch(() => null)
  await update($, tiles, () => [])
}

// The draft's tags are polled: an image paste is not known to raise a prompt event.
async function poll($: $) {
  const id = await $.session.id()
  if (id !== sid) await switchSession($, id)
  const ns = tokensOf((await $.prompt.read()).text)
  // An empty draft: the tags were sent or deleted, and a number may come back for another picture.
  if (ns.length === 0 && (made.size > 0 || tries.size > 0)) forget()
  for (const n of ns) {
    const count = tries.get(n) ?? 0
    if (made.has(n) || pending.has(n) || count >= MAX_TRIES) continue
    tries.set(n, count + 1)
    pending.add(n)
    void attempt($, n, epoch).catch(error => {
      pending.delete(n)
      $.ui.log(`paste-thumb: Image #${n}: ${message(error)}`, { to: 'debug' })
    })
  }
  const have = ns.filter(n => made.has(n))
  const key = have.join(',')
  if (key === shown) return
  shown = key
  await update($, tiles, () => have.map(n => made.get(n)!))
}

function tick($: $) {
  if (polling) return
  polling = true
  poll($)
    .catch(error => $.ui.log(`paste-thumb: ${message(error)}`, { to: 'debug' }))
    .finally(() => (polling = false))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    stop?.()
    stop = e.isInteractive ? $.clock.every(POLL_MS, () => tick($)) : null

    return started
  })

  on('session.end', async ($, e, next) => {
    if (work) await $.process.run(['rm', '-rf', work]).catch(() => null)
    forget()
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
