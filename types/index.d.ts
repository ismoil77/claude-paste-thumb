/** A pasted PNG: the file Claude Code stored it in, and its size in pixels. */
export type Tile = { n: number; file: string; width: number; height: number }

declare module 'claude-code' {
  interface PluginState {
    'paste-thumb': { tiles: Tile[] }
  }
}
