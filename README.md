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
  kitty. Elsewhere the frame shows the text `[Image #1]` instead of the picture.
- PNG works as it is. Any other format (JPEG, WebP, GIF, BMP, TIFF, AVIF, HEIC) is shrunk once to a
  small PNG, which needs [ImageMagick](https://imagemagick.org) (`magick` or `convert`). Without it
  only PNG shows, and the mod says so once.
- Tested on Linux with Claude Code 2.1.312.

### Inside herdr, tmux or another multiplexer

Claude Code decides whether the terminal draws pictures by asking it, and a multiplexer answers for
itself. Set `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` where you start Claude Code (the `env` block of
`~/.claude/settings.json` works) and run the multiplexer inside Ghostty or kitty. [herdr](https://herdr.dev)
passes kitty graphics through; tmux needs its own passthrough setting.

## How it works

- Twice a second it looks for `[Image #N]` tags in the draft.
- It finds the file Claude Code stored for that number, in `<tmp>/claude-<uid>/<project>/<session>/images/`.
- For a PNG the terminal reads the file from there. Only the size is taken, from the first 24 bytes
  of the file, with `od`. Nothing is copied.
- For other formats ImageMagick writes a thumbnail of up to 480 px into a temporary folder, which is
  removed when the session ends.
- The thumbnail is at most 10 rows tall and 48 cells wide.

## Limits

- The folder where Claude Code keeps pasted images is not documented. If a Claude Code update moves
  it, thumbnails stop showing until the mod is updated.
- Mods are an early-access feature of Claude Code and the API may change.
- There is no click-to-enlarge: a pane opened from a mod is not drawn on narrow terminals.

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
