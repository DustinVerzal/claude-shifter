export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Model = 'fable' | 'opus' | 'sonnet' | 'haiku'

declare module 'claude-code' {
  interface PluginState {
    'effort-keys': { effort: Effort | null; model: Model | null; turnRunning: boolean }
  }
}
