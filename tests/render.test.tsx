import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'paste-thumb',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

type Tile = { n: number; file: string; width: number; height: number }

// The mod reads its tiles from `$.state`: this hook stands for the engine's store.
const seed = (on: any, tiles: Tile[]) => on('state.get', () => ({ value: { value: tiles, version: 1 } }))

const engineBand = ($: any, e: any) => {
  const { Text } = $.ui.resolve(e)

  return <Text>engine band</Text>
}

const ONE: Tile[] = [{ n: 5, file: '/tmp/p/5.png', width: 480, height: 270 }]

test('with no thumbnails the engine\'s own band is drawn', async ($, on) => {
  on('ui.render', engineBand)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a pasted picture is drawn as a framed thumbnail above the engine\'s band', async ($, on) => {
  on('ui.render', engineBand)
  seed(on, ONE)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /#5/ }))?.text).toBe('#5')
  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  await ui.unmount()
})

test('several pictures sit side by side, one thumbnail each', async ($, on) => {
  on('ui.render', engineBand)
  seed(on, [
    { n: 1, file: '/tmp/p/1.png', width: 480, height: 270 },
    { n: 2, file: '/tmp/p/2.png', width: 320, height: 480 },
  ])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /#1/ }))?.text).toBe('#1')
  expect((await ui.find({ type: 'Text', text: /#2/ }))?.text).toBe('#2')
  await ui.unmount()
})

test('a survey keeps the band, and other surfaces are left alone', async ($, on) => {
  on('ui.render', engineBand)
  seed(on, ONE)

  const survey = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ type: 'Image' })).toBeUndefined()
  expect((await survey.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  await survey.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /#5/ })).toBeUndefined()
  expect((await desktop.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  await desktop.unmount()
})
