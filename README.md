# paste-thumb

A small mod for [Claude Code](https://claude.com/claude-code). When you paste an image into the
prompt, it shows a thumbnail in a frame right above the input, with the image number under it,
so you can see what you attached before you send.

[Русская версия](README.ru.md)

## Install

At the prompt of a terminal session:

```
/plugin install paste-thumb --marketplace ismoil77/claude-paste-thumb
```

From a shell:

```
claude plugin install paste-thumb --marketplace ismoil77/claude-paste-thumb
```

Answer `y` to add the marketplace and pick a scope; with the user scope the mod loads in every
session. It draws in the terminal only, not in the desktop app.

## What you need

- A terminal that draws pictures with the kitty graphics protocol: [Ghostty](https://ghostty.org) or
  kitty. Elsewhere the frame shows the text `[Image #1]` instead of the picture. The terminal must
  run on the same machine as Claude Code, because it reads the picture files itself; over ssh the
  box may stay empty.
- `od`, `id` and `sh`, which Linux and macOS have.
- PNG works as it is. Claude Code usually stores pasted images as PNG; any other format it keeps
  (JPEG, WebP, GIF, BMP, TIFF, AVIF, HEIC, as far as your ImageMagick can read them) is shrunk once
  to a small PNG, first frame only. That needs [ImageMagick](https://imagemagick.org) (`magick` or
  `convert`). Without it only PNG shows, and the mod says so once per session, the first time it
  meets another format.
- Developed and used on Linux with Claude Code 2.1.312; not tried on macOS.

### Inside herdr, tmux or another multiplexer

Claude Code decides whether the terminal draws pictures by asking it, and a multiplexer may answer
for itself. Set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` in the environment where you start Claude Code,
and run the multiplexer inside Ghostty or kitty. [herdr](https://herdr.dev) draws kitty graphics when
its outer terminal does (its `terminal.kitty_graphics` setting, on by default); a test picture
rendered correctly in herdr inside Ghostty. tmux is not tested.

## How it works

- Twice a second it looks for `[Image #N]` tags in the draft.
- It finds the file Claude Code stored for that number, in `<tmp>/claude-<uid>/<project>/<session>/images/`
  (`<tmp>` is `$CLAUDE_CODE_TMPDIR`, or `/tmp`). It looks again on each poll for about ten seconds if
  the file is not there yet, and says so once if it never shows up.
- For a PNG the terminal reads the file from there. Only the size is taken, from the first 24 bytes
  of the file, with `od`. Nothing is copied.
- For other formats ImageMagick writes a thumbnail of up to 480 px into
  `$TMPDIR/claude-paste-thumb/<session>` (`$TMPDIR`, or `/tmp`). That folder is made only when a
  conversion is needed and is removed when the session ends; the empty parent stays, and nothing is
  removed if the process is killed.
- The thumbnail is at most 10 rows tall and 48 cells wide, and keeps the picture's proportions.
- After `/clear` or a resume it follows the new session's folder.

## Limits

- The folder where Claude Code keeps pasted images is not documented. If a Claude Code update moves
  it, thumbnails stop showing until the mod is updated.
- Mods are an early-access feature of Claude Code and the API may change.
- There is no click-to-enlarge. A picture takes no clicks, and a pane opened from a button was
  reported as not drawn in a narrow terminal when I tried it.

## Development

```
claude plugin validate .
claude plugin test .
```

The logic that does not need Claude Code (tags, paths, PNG header, picture size) is in
`hooks/thumb.ts`; `hooks/register.tsx` holds the hooks. The tests fake the engine's side, including
the clock.

## License

[MIT](LICENSE)
