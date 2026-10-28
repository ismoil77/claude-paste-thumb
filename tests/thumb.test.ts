import { expect, test } from 'claude-code/testing'

import { SIDE, boxFor, isPastedName, parsePngSize, parseSize, projectFolder, tempRoot, thumbArgv, tokensOf } from '../hooks/thumb'

test('tokensOf finds each tag once, in order', async () => {
  expect(tokensOf('look [Image #3] and [Image #1] then [Image #3] again')).toEqual([3, 1])
  expect(tokensOf('[Image #12]')).toEqual([12])
  expect(tokensOf('no tags, [Image] [Image #] [image #2] [Image #x]')).toEqual([])
  expect(tokensOf('')).toEqual([])
})

test('isPastedName takes <n>.<ext> and nothing else', async () => {
  expect(isPastedName('5.png', 5)).toBe(true)
  expect(isPastedName('5.JPG', 5)).toBe(true)
  expect(isPastedName('15.png', 5)).toBe(false)
  expect(isPastedName('5.png.tmp', 5)).toBe(false)
  expect(isPastedName('x5.png', 5)).toBe(false)
  expect(isPastedName('5', 5)).toBe(false)
})

test('the paste folder follows Claude Code\'s layout', async () => {
  expect(projectFolder('/home/ismoil')).toBe('-home-ismoil')
  expect(projectFolder('/home/ismoil/My Projects/app_v2')).toBe('-home-ismoil-My-Projects-app-v2')
  expect(tempRoot(undefined, '1000')).toBe('/tmp/claude-1000')
  expect(tempRoot('/var/tmp/', '0')).toBe('/var/tmp/claude-0')
  expect(tempRoot('', '1000')).toBe('/tmp/claude-1000')
})

// od -An -tu1 -N24 prints 16 numbers a line: the signature, the IHDR chunk's length and name, then width and height
const od = (w: number[], h: number[]) =>
  ` 137  80  78  71  13  10  26  10   0   0   0  13  73  72  68  82\n   ${w.join('   ')}   ${h.join('   ')}\n`

test('parsePngSize reads width and height from the header', async () => {
  expect(parsePngSize(od([0, 0, 1, 224], [0, 0, 1, 14]))).toEqual({ width: 480, height: 270 })
  expect(parsePngSize(od([0, 0, 7, 128], [0, 0, 4, 56]))).toEqual({ width: 1920, height: 1080 })
  // wider than 65535: all four bytes count
  expect(parsePngSize(od([0, 1, 17, 112], [0, 0, 0, 10]))).toEqual({ width: 70000, height: 10 })
})

test('parsePngSize refuses what is not a PNG', async () => {
  // a JPEG starts ff d8 ff e0
  expect(parsePngSize('255 216 255 224   0  16  74  70  73  70   0   1   1   0   0   1   0   1   0   0   0   0   0   0')).toBeNull()
  // PNG signature but no IHDR
  expect(parsePngSize(' 137  80  78  71  13  10  26  10   0   0   0  13  73  72  68  83   0   0   1 224   0   0   1  14')).toBeNull()
  expect(parsePngSize(od([0, 0, 0, 0], [0, 0, 1, 14]))).toBeNull() // a zero width
  expect(parsePngSize('137 80 78 71')).toBeNull() // cut short
  expect(parsePngSize('od: /x/y: No such file or directory')).toBeNull()
  expect(parsePngSize('')).toBeNull()
})

test('boxFor keeps the picture\'s proportions and stays inside the room', async () => {
  expect(boxFor(480, 270, 10, 100)).toEqual({ columns: 36, rows: 10 }) // 16:9, a cell is twice as tall as wide
  expect(boxFor(360, 423, 10, 100)).toEqual({ columns: 17, rows: 10 }) // portrait
  expect(boxFor(480, 270, 6, 12)).toEqual({ columns: 12, rows: 3 }) // a narrow room caps the width, the height follows
  expect(boxFor(6000, 400, 10, 100)).toEqual({ columns: 48, rows: 2 }) // never wider than 48 cells
  expect(boxFor(480, 270, 6, 1)).toEqual({ columns: 2, rows: 1 }) // very little room
  expect(boxFor(10, 480, 10, 100)).toEqual({ columns: 2, rows: 10 }) // a needle still gets two columns
})

test('thumbArgv is one converter call that writes a PNG and prints the size', async () => {
  const argv = thumbArgv('magick', '/tmp/claude-1000/p/s/images/2.jpg', '/tmp/work/2-9.png')
  expect(argv[0]).toBe('magick')
  // the first frame only, so a gif or a multi-page file stays one picture
  expect(argv).toContain('/tmp/claude-1000/p/s/images/2.jpg[0]')
  expect(argv).toContain('-auto-orient')
  expect(argv).toContain('-strip')
  expect(argv).toContain(`${SIDE}x${SIDE}>`)
  expect(argv).toContain('PNG32:/tmp/work/2-9.png')
  expect(argv.slice(-3)).toEqual(['-format', '%w %h', 'info:'])
  // the size hint sits before the input, where the decoder reads it
  expect(argv.indexOf('jpeg:size=960x960')).toBeLessThan(argv.indexOf('/tmp/claude-1000/p/s/images/2.jpg[0]'))
})

test('thumbArgv keeps a path with spaces as one argument', async () => {
  const argv = thumbArgv('convert', '/tmp/a b/c d/7.webp', '/tmp/w x/7-1.png')
  expect(argv).toContain('/tmp/a b/c d/7.webp[0]')
  expect(argv).toContain('PNG32:/tmp/w x/7-1.png')
})

test('parseSize reads "width height" and refuses the rest', async () => {
  expect(parseSize('480 270')).toEqual({ width: 480, height: 270 })
  expect(parseSize('480 270\n')).toEqual({ width: 480, height: 270 })
  expect(parseSize('0 270')).toBeNull()
  expect(parseSize('480')).toBeNull()
  expect(parseSize('')).toBeNull()
  expect(parseSize('magick: unable to open image')).toBeNull()
  expect(parseSize('480 270\n480 270')).toBeNull() // two frames would print two lines
})
