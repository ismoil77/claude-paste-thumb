import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'paste-thumb',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const PNG_480x270 = ' 137  80  78  71  13  10  26  10   0   0   0  13  73  72  68  82\n   0   0   1 224   0   0   1  14\n'
const JPEG = ' 255 216 255 224   0  16  74  70  73  70   0   1   1   0   0   1\n   0   1   0   0   0   0   0   0\n'
const IMAGES = '/tmp/claude-1000/-home-u/sess-1/images'

type Options = {
  od?: { exitCode: number; stdout: string }
  guessMissing?: boolean
  converter?: string
  convertExit?: number
  env?: Record<string, string>
  hold?: boolean
}

// The whole path with the engine's side faked: a tag appears in the draft, the picture appears in
// Claude Code's folder, its header is read (or it is converted), a tile is kept.
function world(on: any, options: Options = {}) {
  const clock = mock.clock(on)
  mock.env(on, options.env ?? {})
  let release: () => void = () => {}
  const held = options.hold ? new Promise<void>(r => (release = r)) : null
  const state = {
    prompt: '',
    sid: 'sess-1',
    files: [] as string[],
    sizes: {} as Record<string, number>,
    od: undefined as undefined | ((file: string) => string),
    odCalls: [] as string[][],
    convCalls: [] as string[][],
    ran: [] as string[][],
    listed: [] as string[],
    toasts: [] as string[],
    logs: [] as string[],
    promptReads: 0,
    failReads: 0,
    release: () => release(),
  }
  on('process.run', async (_: any, e: any) => {
    const argv = e.argv as string[]
    const [cmd] = argv
    state.ran.push(argv)
    if (cmd === 'sh') return { value: { exitCode: 0, stdout: `${options.converter ?? '/usr/bin/magick'}\n`, stderr: '' } }
    if (cmd === '/usr/bin/magick' || cmd === 'magick') {
      state.convCalls.push(argv)
      if (held) await held
      if (options.convertExit) return { value: { exitCode: options.convertExit, stdout: '', stderr: 'no decode delegate' } }

      return { value: { exitCode: 0, stdout: '480 270', stderr: '' } }
    }
    if (cmd === 'id') return { value: { exitCode: 0, stdout: '1000\n', stderr: '' } }
    if (cmd === 'od') {
      state.odCalls.push(argv)
      if (state.od) return { value: { exitCode: 0, stderr: '', stdout: state.od(argv.at(-1)!) } }

      return { value: { stderr: '', ...(options.od ?? { exitCode: 0, stdout: PNG_480x270 }) } }
    }

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.exists', (_: any, e: any) => ({ value: options.guessMissing ? e.path.includes('other-project') : true }))
  on('fs.list', (_: any, e: any) => {
    state.listed.push(e.path)
    if (e.path === '/tmp/claude-1000') return { value: [{ name: 'other-project', kind: 'dir', size: 0, mtimeMs: 0 }] }

    return { value: state.files.map(name => ({ name, kind: 'file', size: state.sizes[name] ?? 5000, mtimeMs: 0 })) }
  })
  on('ui.toast', (_: any, e: any) => {
    state.toasts.push(e.text ?? JSON.stringify(e))

    return { value: undefined }
  })
  on('ui.log', (_: any, e: any) => {
    state.logs.push(e.text ?? JSON.stringify(e))

    return { value: undefined }
  })
  on('session.id', () => ({ value: state.sid }))
  on('session.cwd', () => ({ value: '/home/u' }))
  on('prompt.read', () => {
    state.promptReads += 1
    if (state.failReads > 0) {
      state.failReads -= 1
      throw new Error('prompt is gone')
    }

    return { value: { text: state.prompt, cursor: state.prompt.length } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: state.sid }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  return { clock, state }
}

const start = ($: any, over: Record<string, unknown> = {}) =>
  $.session.start({ cwd: '/home/u', surface: 'terminal', isInteractive: true, ...over })

// The thumbnails on screen, by their captions "#n".
async function shown($: any): Promise<number[]> {
  const ui = await $.ui.mount(BAND)
  const found: number[] = []
  for (let n = 1; n <= 9; n++) if (await ui.find({ type: 'Text', text: new RegExp(`^#${n}$`) })) found.push(n)
  const images = await ui.find({ type: 'Image' })
  await ui.unmount()
  if (found.length > 0) expect(images).toBeDefined()

  return found
}

const poll = async (clock: any, times = 1) => {
  for (let i = 0; i < times; i++) await clock.advance(500)
}

// a tag appears; the poll starts the read, the next poll draws what it found
const paste = async (clock: any, state: any, text: string) => {
  state.prompt = text
  await poll(clock, 2)
}

test('a pasted tag becomes a thumbnail, found even when the file lands a moment late', async ($, on) => {
  const { clock, state } = world(on)
  await start($)

  state.prompt = '[Image #1]'
  await poll(clock) // the tag is seen; the file is not there yet
  expect(state.odCalls).toHaveLength(0)
  expect(await shown($)).toEqual([])

  state.files = ['1.png']
  await poll(clock) // the next poll's try finds it
  expect(state.odCalls).toEqual([['od', '-An', '-tu1', '-N24', `${IMAGES}/1.png`]])
  await poll(clock) // and the one after draws it
  expect(await shown($)).toEqual([1])
})

test('a file that is still being written is waited for, not converted', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  state.sizes['1.png'] = 10
  await start($)

  await paste(clock, state, '[Image #1]')
  await poll(clock, 3)
  expect(state.odCalls).toHaveLength(0)
  expect(state.convCalls).toHaveLength(0)

  state.sizes['1.png'] = 5000
  await poll(clock, 3)
  expect(state.odCalls).toHaveLength(1)
  expect(await shown($)).toEqual([1])
})

test('the same tag is read once, however long it stays in the draft', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['3.png']
  await start($)

  await paste(clock, state, 'what is [Image #3] ?')
  await poll(clock, 10)
  expect(state.odCalls).toHaveLength(1)
})

test('sending the draft clears the band, and a reused number is read again', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  expect(await shown($)).toEqual([1])

  state.prompt = '' // sent
  await poll(clock)
  expect(await shown($)).toEqual([])

  await paste(clock, state, '[Image #1]') // another picture under the same number
  expect(state.odCalls).toHaveLength(2)
  expect(await shown($)).toEqual([1])
})

test('two tags make two thumbnails, and deleting one drops only it', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png', '2.png']
  await start($)

  await paste(clock, state, '[Image #1] [Image #2]')
  expect(state.odCalls).toHaveLength(2)
  expect(await shown($)).toEqual([1, 2])

  state.prompt = '[Image #2]'
  await poll(clock)
  expect(state.odCalls).toHaveLength(2)
  expect(await shown($)).toEqual([2])
})

test('a PNG is shown from where it lies, with no converter at all', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  expect(await shown($)).toEqual([1])
  expect(state.convCalls).toHaveLength(0)
  expect(state.ran.some(a => a[0] === 'sh')).toBe(false) // ImageMagick was not even looked for
})

for (const name of ['1.jpg', '1.HEIC']) {
  test(`${name} is shrunk to a small PNG once, and shown`, async ($, on) => {
    const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG } })
    state.files = [name]
    await start($)

    await paste(clock, state, '[Image #1]')
    await poll(clock, 5)
    expect(state.convCalls).toHaveLength(1)
    const argv = state.convCalls[0]!
    expect(argv).toContain(`${IMAGES}/${name}[0]`)
    expect(argv.some(a => /^PNG32:\/tmp\/claude-paste-thumb\/sess-1\/1-\d+\.png$/.test(a))).toBe(true)
    expect(state.ran.some(a => a[0] === 'mkdir' && a.includes('/tmp/claude-paste-thumb/sess-1'))).toBe(true)
    expect(await shown($)).toEqual([1])
  })
}

test('no ImageMagick: one toast for the whole session, PNGs still show', async ($, on) => {
  const { clock, state } = world(on, { converter: '' })
  state.files = ['1.jpg', '2.jpg', '3.png']
  state.od = (f: string) => (f.endsWith('.png') ? PNG_480x270 : JPEG)
  await start($)

  await paste(clock, state, '[Image #1] [Image #2]')
  await poll(clock, 5)
  expect(state.toasts.filter(t => /ImageMagick/.test(t))).toHaveLength(1)
  expect(state.convCalls).toHaveLength(0)
  expect(await shown($)).toEqual([])

  await paste(clock, state, '[Image #3]') // a PNG pasted later in the same session still shows
  expect(await shown($)).toEqual([3])
  expect(state.toasts.filter(t => /ImageMagick/.test(t))).toHaveLength(1)
})

test('a converter that fails is logged, and tried only a few times', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG }, convertExit: 1 })
  state.files = ['1.jpg']
  await start($)

  await paste(clock, state, '[Image #1]')
  await poll(clock, 30)
  expect(await shown($)).toEqual([])
  expect(state.convCalls.length).toBeGreaterThan(0)
  expect(state.convCalls.length).toBeLessThanOrEqual(4)
  expect(state.logs.join('\n')).toMatch(/could not convert Image #1 \(exit 1: no decode delegate\)/)
  expect(state.toasts.join(' ')).toMatch(/cannot find pasted Image #1/)
})

test('if od cannot read the file, the converter still gets to try', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 1, stdout: '' } })
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  await poll(clock, 3)
  expect(state.odCalls).toHaveLength(1)
  expect(state.convCalls).toHaveLength(1)
  expect(await shown($)).toEqual([1])
})

test('a file that never appears is given up on, said once, and not retried forever', async ($, on) => {
  const { clock, state } = world(on)
  await start($)

  await paste(clock, state, '[Image #1]')
  await poll(clock, 60)
  expect(state.odCalls).toHaveLength(0)
  expect(await shown($)).toEqual([])
  // one listing of the images folder per try, and no more than the budget
  expect(state.listed.filter(p => p === IMAGES).length).toBe(20)
  expect(state.toasts.filter(t => /cannot find pasted Image #1/.test(t))).toHaveLength(1)
  expect(state.logs.join('\n')).toMatch(/no readable 1\.\* in /)
})

test('when the guessed project folder is missing, the session\'s folder is found by scanning', async ($, on) => {
  const { clock, state } = world(on, { guessMissing: true })
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  expect(state.odCalls[0]?.at(-1)).toBe('/tmp/claude-1000/other-project/sess-1/images/1.png')
  expect(await shown($)).toEqual([1])
})

test('the temp folders follow CLAUDE_CODE_TMPDIR and TMPDIR', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG }, env: { CLAUDE_CODE_TMPDIR: '/var/tmp/', TMPDIR: '/scratch/' } })
  state.files = ['1.jpg']
  state.listed = []
  await start($)

  await paste(clock, state, '[Image #1]')
  await poll(clock, 3)
  expect(state.listed).toContain('/var/tmp/claude-1000/-home-u/sess-1/images')
  expect(state.convCalls[0]?.some(a => /^PNG32:\/scratch\/claude-paste-thumb\/sess-1\/1-\d+\.png$/.test(a))).toBe(true)
})

test('after /clear the new session\'s folder is used, not the old one', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG } })
  state.files = ['1.jpg']
  await start($)
  await paste(clock, state, '[Image #1]')
  await poll(clock, 3)
  expect(await shown($)).toEqual([1])

  // /clear: the conversation ends, the process goes on under a new session id, and no session.start fires
  await $.session.end({ reason: 'clear' })
  state.sid = 'sess-2'
  state.files = [] // the old session's 1.jpg stays on disk, but in the old folder
  state.prompt = '[Image #1]'
  await poll(clock, 3)
  expect(await shown($)).toEqual([]) // not the previous conversation's picture
  expect(state.listed).toContain('/tmp/claude-1000/-home-u/sess-2/images')

  state.files = ['1.jpg']
  await poll(clock, 4)
  expect(await shown($)).toEqual([1])
  // a fresh work folder for the new session, and the old one removed
  expect(state.ran.some(a => a[0] === 'mkdir' && a.includes('/tmp/claude-paste-thumb/sess-2'))).toBe(true)
  expect(state.ran.some(a => a[0] === 'rm' && a.includes('/tmp/claude-paste-thumb/sess-1'))).toBe(true)
  expect(state.convCalls.at(-1)?.some(a => a.includes('/sess-2/images/1.jpg'))).toBe(true)
})

test('a second picture arriving while the first converts does not convert the first again', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG }, hold: true })
  state.files = ['1.jpg', '2.jpg']
  await start($)

  state.prompt = '[Image #1]'
  await poll(clock) // the conversion of #1 starts and is held
  state.prompt = '[Image #1] [Image #2]'
  await poll(clock, 3)
  expect(state.convCalls.filter(a => a.some(x => x.includes('/1.jpg')))).toHaveLength(1)

  state.release()
  await poll(clock, 4)
  expect(state.convCalls).toHaveLength(2)
  expect(await shown($)).toEqual([1, 2])
})

test('a conversion that finishes after the draft was sent shows nothing', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG }, hold: true })
  state.files = ['1.jpg']
  await start($)

  state.prompt = '[Image #1]'
  await poll(clock) // the conversion starts and is held
  state.prompt = '' // sent meanwhile
  await poll(clock, 2)

  state.release()
  await poll(clock, 3)
  expect(await shown($)).toEqual([]) // the late tile was dropped
})

test('a failing poll is logged and the next poll works', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  state.failReads = 2
  await start($)

  await paste(clock, state, '[Image #1]')
  await poll(clock, 3)
  expect(state.logs.join('\n')).toMatch(/paste-thumb: .*prompt\.read/)
  expect(await shown($)).toEqual([1])
})

test('a session without a prompt (headless) never polls', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  state.prompt = '[Image #1]'
  await start($, { surface: null, isInteractive: false })

  await poll(clock, 10)
  expect(state.promptReads).toBe(0)
  expect(state.odCalls).toHaveLength(0)
})

test('starting twice does not run two pollers', async ($, on) => {
  const { clock, state } = world(on)
  await start($)
  await start($)

  state.promptReads = 0
  await poll(clock, 4)
  expect(state.promptReads).toBe(4)
})

test('ending the session removes the work folder and clears the band', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)
  await paste(clock, state, '[Image #1]')
  expect(await shown($)).toEqual([1])

  await $.session.end({ reason: 'exit' })
  expect(state.ran.some(a => a[0] === 'rm' && a.includes('/tmp/claude-paste-thumb/sess-1'))).toBe(true)
  expect(await shown($)).toEqual([])
})
