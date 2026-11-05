import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'effortless',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 80, maxRows: 10 },
} as const

test('the dot follows arrows, clamps at the edges, and ctrl+1..5 and a typed /effort move it', async ($, on) => {
  const env: Record<string, string | undefined> = {}
  const asks: string[] = []
  let answer: string | null = null
  const messages: SessionMessage[] = []
  const clock = mock.clock(on)

  // As the engine counts: a local command's row is a user turn, though nothing was sent.
  on('session.turns', () => ({ value: messages.filter(m => m.role === 'user').length }))
  on('session.messages', () => ({ value: messages }))
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

  // Seeded from settings, and the indicator shows it until a key opens the bar.
  expect(await ui.find({ key: 'indicator', text: /opus xhigh/ })).toBeDefined()

  // Right to max, then clamped at the edge.
  await $.command.run({ command: 'dot-right' })
  await $.command.run({ command: 'dot-right' })
  await clock.advance(200)
  expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')
  expect(await dotAt('opus-max')).toBe(true)

  // Up to fable, then clamped at the edge; down moves away from it.
  await $.command.run({ command: 'dot-up' })
  await $.command.run({ command: 'dot-up' })
  expect(await dotAt('fable-max')).toBe(true)
  await $.command.run({ command: 'dot-down' })
  expect(await dotAt('opus-max')).toBe(true)

  // No question before the conversation starts, even with /clear's row in the transcript.
  messages.push({ role: 'user', text: '<command-name>/clear</command-name>', toolUses: [] })
  await $.command.run({ command: 'dot-up' })
  await $.command.run({ command: 'dot-down' })
  expect(asks).toEqual([])
  messages.push({ role: 'assistant', text: 'ok', toolUses: [] })

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

  // ctrl+1..5 set effort alone.
  await $.command.run({ command: 'dot-down' })
  await ui.press({ key: 'low' })
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

test('/clear keeps the dot and the model override, though it empties $.state', async ($, on) => {
  const sent: string[] = []
  let cleared = false

  mock.clock(on)

  // /clear starts a new session id with empty state and no session.start.
  on('state.get', (_, e, next) => (cleared ? { value: { value: undefined, version: 0 } } : next(e)))
  on('session.turns', () => ({ value: 1 }))
  on('session.messages', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.run', () => ({}))
  on('turn.step', async function* (_, e) {
    sent.push(e.model)

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'dot-down' })

  const clear = async () => {
    cleared = false
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    cleared = true
  }

  await clear()

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ key: 'indicator', text: /sonnet high/ })).toBeDefined()

  // The moved dot still picks the model a request goes to.
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
  }
  expect(sent).toEqual(['sonnet'])

  // A second /clear, with nothing in state to snapshot, keeps it too.
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(await ui.find({ key: 'indicator', text: /sonnet high/ })).toBeDefined()
  await ui.unmount()
})

test('an effort key stretches the bar open, a model key the grid after it, and both fold back to the indicator', async ($, on) => {
  const clock = mock.clock(on)
  const asks: Array<() => void> = []
  const messages: SessionMessage[] = []

  on('session.messages', () => ({ value: messages }))
  // Held open until the test answers, as a person looking at the dialog would.
  on('tool.call', { tool: 'AskUserQuestion' }, () =>
    new Promise(resolve => {
      asks.push(() => resolve({ deny: 'dismissed' }))
    }),
  )
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  const drawn = async (key: string) => (await ui.find({ key })) !== undefined
  const resting = async () => (await ui.find({ key: 'indicator', text: /^\w+ \w+$/ })) !== undefined
  const widthOf = async (key: string) => (await ui.find({ key }))!.text.length
  // The chords stay mounted with nothing on them, so no form has anything to click.
  const nothingToClick = async () => expect(await ui.find({ type: 'Button', text: /\S/ })).toBeUndefined()

  // At rest: the model and effort alone, every effort chord still mounted, no bar.
  expect((await ui.find({ key: 'indicator' }))!.text).toBe('opus high')
  for (const key of ['low', 'medium', 'high', 'xhigh', 'max']) expect(await drawn(key)).toBe(true)
  expect(await ui.find({ text: /●/ })).toBeUndefined()
  expect(await drawn('opus-high')).toBe(false)
  await nothingToClick()

  // An effort key draws the moved dot in its own frame, and the bar stretches out from there.
  await $.command.run({ command: 'dot-right' })
  expect(await ui.find({ key: 'bar-xhigh', text: /●/ })).toBeDefined()
  expect(await resting()).toBe(false)
  expect(await drawn('opus-high')).toBe(false)
  await nothingToClick()

  const first = await widthOf('bar-xhigh')

  await clock.advance(120)
  expect(await widthOf('bar-xhigh')).toBeGreaterThan(first)
  expect(await drawn('opus-high')).toBe(false)

  // Then the names go over it, and no other model's row opens.
  await clock.advance(80)
  expect(await ui.find({ key: 'opus-xhigh', text: /●/ })).toBeDefined()
  expect(await drawn('opus-high')).toBe(true)
  expect(await drawn('fable-high')).toBe(false)
  expect(await drawn('sonnet-high')).toBe(false)

  // Nor does ctrl+1..5.
  await ui.press({ key: 'high' })
  await clock.advance(200)
  expect(await drawn('sonnet-high')).toBe(false)

  // It folds back from there on the same hold, through the bar to the indicator.
  await clock.advance(1000)
  expect(await drawn('opus-high')).toBe(true)
  await clock.advance(150)
  expect(await drawn('opus-high')).toBe(false)
  expect(await ui.find({ key: 'bar-high', text: /●/ })).toBeDefined()
  await clock.advance(160)
  expect(await resting()).toBe(true)

  // A model key draws the moved dot in its own frame, the bar stretching and then the grid unfolding.
  await $.command.run({ command: 'dot-down' })
  expect(await ui.find({ key: 'indicator', text: /sonnet/ })).toBeDefined()
  expect(await ui.find({ key: 'bar-high', text: /●/ })).toBeDefined()
  expect(await resting()).toBe(false)

  await clock.advance(160)
  expect(await ui.find({ key: 'sonnet-high', text: /●/ })).toBeDefined()
  expect(await drawn('opus-high')).toBe(false)

  await clock.advance(40)
  expect(await drawn('opus-high')).toBe(true)
  expect(await drawn('haiku-high')).toBe(true)
  expect(await drawn('fable-high')).toBe(false)

  await clock.advance(80)
  expect(await drawn('fable-high')).toBe(true)
  await nothingToClick()

  // An effort key before the hold ends starts it over, and leaves the open rows drawn.
  await clock.advance(1000)
  await $.command.run({ command: 'dot-right' })
  await clock.advance(1100)
  expect(await drawn('fable-high')).toBe(true)

  // An effort key halfway through the fold holds the rows still drawn, and the dot never waits.
  await clock.advance(100 + 150 + 40)
  expect(await drawn('opus-high')).toBe(true)
  expect(await drawn('fable-high')).toBe(false)
  await $.command.run({ command: 'dot-left' })
  expect(await ui.find({ key: 'sonnet-high', text: /●/ })).toBeDefined()
  await clock.advance(200)
  expect(await drawn('opus-high')).toBe(true)
  expect(await drawn('fable-high')).toBe(false)

  // A model key halfway through the fold opens again from there.
  await clock.advance(1000 + 150)
  expect(await drawn('sonnet-high')).toBe(true)
  expect(await drawn('opus-high')).toBe(false)
  await $.command.run({ command: 'dot-up' })
  await clock.advance(200)
  expect(await drawn('haiku-high')).toBe(true)

  // Left alone it folds away completely.
  await clock.advance(1200 + 150 + 280)
  expect(await resting()).toBe(true)
  expect(await drawn('opus-high')).toBe(false)

  // The grid waits for a dialog however long it stays up.
  messages.push({ role: 'assistant', text: 'ok', toolUses: [] })

  const moving = $.command.run({ command: 'dot-up' })

  await clock.advance(280 + 60000)
  expect(asks.length).toBe(1)
  expect(await drawn('haiku-high')).toBe(true)

  asks[0]!()
  await moving
  await clock.advance(1200 + 150 + 280)
  expect(await resting()).toBe(true)
  await ui.unmount()
})

test('the dot keeps its column from the bar into the grid, and the row fits the column', async ($, on) => {
  const clock = mock.clock(on)

  on('session.messages', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('command.run', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

  for (const bodyColumns of [200, 79, 45, 29]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns } })

    // The last frame of the bar, before the names go over it. Up opens the grid even at the top.
    await $.command.run({ command: 'dot-up' })
    await clock.advance(120)

    const label = (await ui.find({ key: 'indicator' }))!.text
    const cells = await Promise.all(LEVELS.map(async key => (await ui.find({ key: `bar-${key}` }))!.text))

    expect(label.length + cells.join('').length + ' xhigh'.length).toBeLessThanOrEqual(bodyColumns)
    expect(cells.join('').replace(/[ ━─]/g, '')).toBe('···●·')
    // Filled up to the dot, plain after it.
    if (bodyColumns >= 79) {
      expect(cells[3]).toContain('━●─')
      expect(cells[2]).not.toContain('─')
      expect(cells[4]).not.toContain('━')
    }

    await clock.advance(160)
    expect(await Promise.all(LEVELS.map(async key => (await ui.find({ key: `fable-${key}` }))!.text))).toEqual(cells)

    await clock.advance(1200 + 150 + 280)
    await ui.unmount()
  }

  // The /effort slider's colors, with a rainbow step for each of max's columns and letters.
  const ui = await $.ui.mount(BAND)
  const find = (text: RegExp) => ui.find({ type: 'Text', text })
  const COLORS = [
    ['low', 'warning'],
    ['medium', 'success'],
    ['high', 'permission'],
    ['xhigh', 'autoAccept'],
    ['max', 'rainbow_blue'],
  ] as const

  for (const [level, color] of COLORS) {
    await ui.press({ key: level })
    await clock.advance(200)
    expect((await find(/^●$/))?.props.color).toBe(color)
  }

  expect((await find(/^━+$/))?.props.color).toBe('rainbow_red')
  expect((await find(/^m$/))?.props.color).toBe('rainbow_red')
  expect((await find(/^x$/))?.props.color).toBe('rainbow_yellow')

  // Fading, the selected label dims with the rest of the header; the word beside the dot keeps its colors.
  await clock.advance(1100)
  expect((await find(/^ *max *$/))?.props.dimColor).toBe(true)
  expect((await find(/^m$/))?.props.color).toBe('rainbow_red')

  await clock.advance(150 + 200)
  expect(await ui.find({ text: /●/ })).toBeUndefined()
  await ui.unmount()
})

test('with no effort known yet, the indicator is the model alone', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ key: 'indicator' }))!.text).toBe('opus')
  await ui.unmount()
})
