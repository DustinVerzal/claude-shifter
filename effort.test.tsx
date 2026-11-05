import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'effort-keys',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 80, maxRows: 10 },
} as const

test('the dot follows arrows, clamps at the edges, and clicks and a typed /effort move it', async ($, on) => {
  const env: Record<string, string | undefined> = {}
  const toasts: string[] = []
  let turns = 0

  on('session.turns', () => ({ value: turns }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.set', (_, e) => {
    env[e.name] = e.value

    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  // The per-model level wins over the global one, as it does in the engine.
  on('settings.read', () => ({
    value: { effortLevel: 'low', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  const dotAt = async (key: string) => (await ui.find({ key, text: /●/ })) !== undefined

  expect(await dotAt('opus-xhigh')).toBe(true)

  // Right to max, then clamped at the edge.
  await $.command.run({ command: 'dot-right' })
  await $.command.run({ command: 'dot-right' })
  expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')
  expect(await dotAt('opus-max')).toBe(true)

  // Up to fable, then clamped at the edge; down moves away from it.
  await $.command.run({ command: 'dot-up' })
  await $.command.run({ command: 'dot-up' })
  expect(await dotAt('fable-max')).toBe(true)
  await $.command.run({ command: 'dot-down' })
  expect(await dotAt('opus-max')).toBe(true)

  // No warning before the conversation starts; once, not twice, in a burst after it.
  expect(toasts).toEqual([])
  turns = 1
  await $.command.run({ command: 'dot-up' })
  await $.command.run({ command: 'dot-down' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('mid-session')

  // A cell sets both axes; a column header sets effort alone.
  await ui.press({ key: 'sonnet-low' })
  expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('low')
  expect(await dotAt('sonnet-low')).toBe(true)
  await ui.press({ key: 'high' })
  expect(await dotAt('sonnet-high')).toBe(true)

  // A typed /effort drops the override and moves the dot.
  await $.command.run({ command: 'effort', args: 'max' })
  expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined()
  expect(await dotAt('sonnet-max')).toBe(true)
  await ui.unmount()
})
