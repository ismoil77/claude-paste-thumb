import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'paste-thumb',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const PNG_480x270 = ' 137  80  78  71  13  10  26  10   0   0   0  13  73  72  68  82\n   0   0   1 224   0   0   1  14\n'
const JPEG = ' 255 216 255 224   0  16  74  70  73  70   0   1   1   0   0   1\n   0   1   0   0   0   0   0   0\n'

// The whole path with the engine's side faked: a tag appears in the draft, the picture appears in
// Claude Code's folder, its header is read, a tile is kept.
function world(on: any, options: { od?: { exitCode: number; stdout: string }; guessMissing?: boolean; converter?: string; convertExit?: number } = {}) {
  const clock = mock.clock(on)
  mock.env(on, {})
  const state = { prompt: '', files: [] as string[], odCalls: [] as string[][], listed: [] as string[], ran: [] as string[][], convCalls: [] as string[][], toasts: [] as string[], od: undefined as undefined | ((file: string) => string) }
  on('process.run', (_: any, e: any) => {
    const [cmd] = e.argv as string[]
    state.ran.push(e.argv)
    if (cmd === 'sh') return { value: { exitCode: 0, stdout: `${options.converter ?? '/usr/bin/magick'}\n`, stderr: '' } }
    if (cmd === '/usr/bin/magick' || cmd === 'magick') {
      state.convCalls.push(e.argv)
      if (options.convertExit) return { value: { exitCode: options.convertExit, stdout: '', stderr: 'no decode delegate' } }

      return { value: { exitCode: 0, stdout: '480 270', stderr: '' } }
    }
    if (cmd === 'id') return { value: { exitCode: 0, stdout: '1000\n', stderr: '' } }
    if (cmd === 'od') {
      state.odCalls.push(e.argv)
      if (state.od) return { value: { exitCode: 0, stderr: '', stdout: state.od(e.argv.at(-1)) } }

      return { value: { stderr: '', ...(options.od ?? { exitCode: 0, stdout: PNG_480x270 }) } }
    }

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.exists', (_: any, e: any) => ({ value: options.guessMissing ? e.path.includes('other-project') : true }))
  on('fs.list', (_: any, e: any) => {
    state.listed.push(e.path)
    if (e.path === '/tmp/claude-1000') return { value: [{ name: 'other-project', kind: 'dir' }] }

    return { value: state.files.map(name => ({ name, kind: 'file' })) }
  })
  on('ui.toast', (_: any, e: any) => {
    state.toasts.push(e.text ?? JSON.stringify(e))

    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/home/u' }))
  on('prompt.read', () => ({ value: { text: state.prompt, cursor: state.prompt.length } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sess-1' }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  return { clock, state }
}

const start = ($: any) => $.session.start({ cwd: '/home/u', surface: 'terminal', isInteractive: true })

async function hasImage($: any) {
  const ui = await $.ui.mount(BAND)
  const found = await ui.find({ type: 'Image' })
  await ui.unmount()

  return found !== undefined
}

const paste = async (clock: any, state: any, text: string) => {
  state.prompt = text
  await clock.advance(500) // the poll sees the tags
  await clock.advance(500) // the next poll draws what was read
}

test('a pasted tag becomes a thumbnail, found even when the file lands a moment late', async ($, on) => {
  const { clock, state } = world(on)
  await start($)

  state.prompt = '[Image #1]'
  await clock.advance(500) // the tag is seen; the file is not there yet
  expect(state.odCalls).toHaveLength(0)
  expect(await hasImage($)).toBe(false)

  state.files = ['1.png']
  await clock.advance(250) // the retry finds it
  expect(state.odCalls).toEqual([['od', '-An', '-tu1', '-N24', '/tmp/claude-1000/-home-u/sess-1/images/1.png']])

  await clock.advance(500) // the next poll draws it
  expect(await hasImage($)).toBe(true)
})

test('the same tag is read once, however long it stays in the draft', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['3.png']
  await start($)

  await paste(clock, state, 'what is [Image #3] ?')
  await clock.advance(5000)
  expect(state.odCalls).toHaveLength(1)
})

test('sending the draft clears the band, and a reused number is read again', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  expect(await hasImage($)).toBe(true)

  state.prompt = '' // sent
  await clock.advance(500)
  expect(await hasImage($)).toBe(false)

  await paste(clock, state, '[Image #1]') // another picture under the same number
  expect(state.odCalls).toHaveLength(2)
  expect(await hasImage($)).toBe(true)
})

test('two tags make two thumbnails, and deleting one drops only it', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png', '2.png']
  await start($)

  await paste(clock, state, '[Image #1] [Image #2]')
  expect(state.odCalls).toHaveLength(2)

  state.prompt = '[Image #2]'
  await clock.advance(500)
  expect(state.odCalls).toHaveLength(2)
  expect(await hasImage($)).toBe(true)
})

test('a PNG is shown from where it lies, with no converter at all', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  expect(await hasImage($)).toBe(true)
  expect(state.convCalls).toHaveLength(0)
  expect(state.ran.some(a => a[0] === 'sh')).toBe(false) // ImageMagick was not even looked for
})

for (const ext of ['jpg', 'webp', 'gif', 'heic']) {
  test(`a ${ext} is shrunk to a small PNG once, and shown`, async ($, on) => {
    const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG } })
    state.files = [`1.${ext}`]
    await start($)

    await paste(clock, state, '[Image #1]')
    await clock.advance(5000)
    expect(state.convCalls).toHaveLength(1)
    const argv = state.convCalls[0]!
    expect(argv).toContain(`/tmp/claude-1000/-home-u/sess-1/images/1.${ext}[0]`)
    expect(argv.some(a => /^PNG32:\/tmp\/claude-paste-thumb\/sess-1\/1-\d+\.png$/.test(a))).toBe(true)
    expect(state.ran.some(a => a[0] === 'mkdir' && a.includes('/tmp/claude-paste-thumb/sess-1'))).toBe(true)
    expect(await hasImage($)).toBe(true)
  })
}

test('no ImageMagick: one toast for the whole session, PNGs still show', async ($, on) => {
  const { clock, state } = world(on, { converter: '' })
  state.files = ['1.jpg', '2.jpg', '3.png']
  state.od = (f: string) => (f.endsWith('.png') ? PNG_480x270 : JPEG)
  await start($)

  await paste(clock, state, '[Image #1] [Image #2]')
  await clock.advance(5000)
  expect(state.toasts.filter(t => /ImageMagick/.test(t))).toHaveLength(1)
  expect(state.convCalls).toHaveLength(0)
  expect(await hasImage($)).toBe(false)

  // a PNG pasted later in the same session still shows
  await paste(clock, state, '[Image #3]')
  expect(await hasImage($)).toBe(true)
  expect(state.toasts.filter(t => /ImageMagick/.test(t))).toHaveLength(1)
})

test('a converter that fails leaves the tag as plain text, without a loop', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 0, stdout: JPEG }, convertExit: 1 })
  state.files = ['1.jpg']
  await start($)

  await paste(clock, state, '[Image #1]')
  await clock.advance(5000)
  expect(state.convCalls).toHaveLength(1)
  expect(await hasImage($)).toBe(false)
})

test('ending the session removes the work folder, but only if one was made', async ($, on) => {
  const converted = world(on, { od: { exitCode: 0, stdout: JPEG } })
  converted.state.files = ['1.jpg']
  await start($)
  await paste(converted.clock, converted.state, '[Image #1]')
  await $.session.end({ reason: 'exit' })
  expect(converted.state.ran.some(a => a[0] === 'rm' && a.includes('/tmp/claude-paste-thumb/sess-1'))).toBe(true)
})

test('a session with only PNGs removes nothing at the end', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)
  await paste(clock, state, '[Image #1]')
  await $.session.end({ reason: 'exit' })
  expect(state.ran.some(a => a[0] === 'rm')).toBe(false)
})

test('if od cannot read the file, the converter still gets to try', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 1, stdout: '' } })
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  await clock.advance(5000)
  expect(state.odCalls).toHaveLength(1)
  expect(state.convCalls).toHaveLength(1)
  expect(await hasImage($)).toBe(true)
})

test('if od and the converter both fail, the tag stays plain text, without a loop', async ($, on) => {
  const { clock, state } = world(on, { od: { exitCode: 1, stdout: '' }, convertExit: 1 })
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  await clock.advance(5000)
  expect(state.odCalls).toHaveLength(1)
  expect(state.convCalls).toHaveLength(1)
  expect(await hasImage($)).toBe(false)
})

test('a file that never appears is given up on, and nothing is read', async ($, on) => {
  const { clock, state } = world(on)
  await start($)

  await paste(clock, state, '[Image #1]')
  await clock.advance(10_000)
  expect(state.odCalls).toHaveLength(0)
  expect(await hasImage($)).toBe(false)
})

test('when the guessed project folder is missing, the session\'s folder is found by scanning', async ($, on) => {
  const { clock, state } = world(on, { guessMissing: true })
  state.files = ['1.png']
  await start($)

  await paste(clock, state, '[Image #1]')
  expect(state.odCalls[0]?.at(-1)).toBe('/tmp/claude-1000/other-project/sess-1/images/1.png')
  expect(await hasImage($)).toBe(true)
})

test('ending the session clears the band', async ($, on) => {
  const { clock, state } = world(on)
  state.files = ['1.png']
  await start($)
  await paste(clock, state, '[Image #1]')
  expect(await hasImage($)).toBe(true)

  await $.session.end({ reason: 'exit' })
  expect(await hasImage($)).toBe(false)
})
