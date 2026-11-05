import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'effort-keys',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 80, maxRows: 10 },
} as const

test('the dot follows arrows, clamps at the edges, and clicks and a typed /effort move it', async ($, on) => {
  const env: Record<string, string | undefined> = {}
  const asks: string[] = []
  let answer: string | null = null
  let turns = 0

  on('session.turns', () => ({ value: turns }))
  // $.ui.ask is a tool.call of the engine's question dialog; a dismissal is a deny.
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const { question } = e.questions[0]!

    asks.push(question)

    if (answer === null) return { deny: 'dismissed' }

    return { result: { questions: e.questions, answers: { [question]: answer } } }
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

  // No question before the conversation starts.
  expect(asks).toEqual([])
  turns = 1

  // Dismissing, keeping and typing under "Other" all leave the dot where it was.
  await $.command.run({ command: 'dot-up' })
  expect(asks.length).toBe(1)
  expect(asks[0]).toContain('fable')
  expect(await dotAt('opus-max')).toBe(true)

  answer = 'Keep opus'
  await $.command.run({ command: 'dot-up' })
  expect(await dotAt('opus-max')).toBe(true)

  answer = 'whatever'
  await $.command.run({ command: 'dot-up' })
  expect(await dotAt('opus-max')).toBe(true)

  // A declined cell changes neither axis.
  await ui.press({ key: 'sonnet-low' })
  expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')
  expect(await dotAt('opus-max')).toBe(true)

  // Effort alone never asks.
  asks.length = 0
  await ui.press({ key: 'high' })
  await ui.press({ key: 'max' })
  expect(asks).toEqual([])

  // Agreeing moves it, and no later move asks again before the next request.
  answer = 'Switch to fable'
  await $.command.run({ command: 'dot-up' })
  expect(await dotAt('fable-max')).toBe(true)
  await $.command.run({ command: 'dot-down' })
  expect(await dotAt('opus-max')).toBe(true)
  expect(asks.length).toBe(1)

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
