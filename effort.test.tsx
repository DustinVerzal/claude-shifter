import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'effortless',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, bodyColumns: 80, maxRows: 10 },
} as const
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
// Hook timers run on the mock clock and frames on the drawing's own, so each test moves them apart.
// Frame assertions stay on order and direction: a frame's size follows the wall clock.
const HOLD = 1400
const SETTLE = 400

test('the dot follows arrows, clamps at the edges, and ctrl+1..5 and a typed /effort move it', async ($, on) => {
  const env: Record<string, string | undefined> = {}
  const asks: string[] = []
  let answer: string | null = null
  const messages: SessionMessage[] = []

  mock.clock(on)

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
  const dotAt = async (key: string) => (await ui.find({ key, text: /●/, in: 'band' })) !== undefined

  // Seeded from settings, and the indicator shows it until a key opens the bar.
  expect(await ui.find({ key: 'indicator', text: /opus xhigh/, in: 'band' })).toBeDefined()

  // Right to max, then clamped at the edge.
  await $.command.run({ command: 'dot-right' })
  await $.command.run({ command: 'dot-right' })
  await ui.advance(SETTLE)
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

  expect(await ui.find({ key: 'indicator', text: /sonnet high/, in: 'band' })).toBeDefined()

  // The moved dot still picks the model a request goes to.
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
  }
  expect(sent).toEqual(['sonnet'])

  // A second /clear, with nothing in state to snapshot, keeps it too.
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(await ui.find({ key: 'indicator', text: /sonnet high/, in: 'band' })).toBeDefined()
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
  const inBand = (query: { key?: string; text?: RegExp }) => ui.find({ ...query, in: 'band' })
  const drawn = async (key: string) => (await inBand({ key })) !== undefined
  const resting = async () => (await inBand({ key: 'indicator', text: /^\w+ \w+$/ })) !== undefined
  const barCells = () => Promise.all(LEVELS.map(async level => (await inBand({ key: `bar-${level}` }))?.text ?? ''))
  const barWidth = async () => (await barCells()).join('').length
  const openRows = async () =>
    (await Promise.all(['fable', 'opus', 'sonnet', 'haiku'].map(async row => ((await drawn(`${row}-high`)) ? row : '')))).filter(Boolean)
  // The chords stay mounted with nothing on them, and the band draws no Buttons, so nothing can be clicked.
  const nothingToClick = async () => {
    expect(await ui.find({ type: 'Button', text: /\S/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', in: 'band' })).toBeUndefined()
  }

  // At rest: the model and effort alone, every effort chord still mounted, no bar.
  expect((await inBand({ key: 'indicator' }))!.text).toBe('opus high')
  for (const key of LEVELS) expect(await ui.find({ key })).toBeDefined()
  expect(await inBand({ text: /●/ })).toBeUndefined()
  expect(await drawn('opus-high')).toBe(false)
  await nothingToClick()

  // An effort key draws the moved dot in its own frame, and the bar stretches out from there.
  await $.command.run({ command: 'dot-right' })
  expect(await inBand({ key: 'bar-xhigh', text: /●/ })).toBeDefined()
  expect(await resting()).toBe(false)
  expect(await drawn('opus-high')).toBe(false)
  await nothingToClick()

  // The cells share the columns unevenly, so a frame can add fewer than one per cell.
  const sizes = (await barCells()).map(cell => cell.length)

  expect(Math.max(...sizes) - Math.min(...sizes)).toBe(1)

  // It only ever grows, and the names wait for it.
  const widths = [await barWidth()]

  for (let frame = 0; frame < 30 && !(await drawn('opus-xhigh')); frame++) {
    await ui.advance(16)

    if (await inBand({ key: 'bar-low' })) widths.push(await barWidth())
  }

  expect(widths.length).toBeGreaterThan(1)
  expect(widths).toEqual([...widths].sort((a, b) => a - b))

  // Then the names go over it, and no other model's row opens.
  await ui.advance(SETTLE)
  expect(await inBand({ key: 'opus-xhigh', text: /●/ })).toBeDefined()
  expect(await drawn('opus-high')).toBe(true)
  expect(await drawn('fable-high')).toBe(false)
  expect(await drawn('sonnet-high')).toBe(false)

  // Nor does ctrl+1..5.
  await ui.press({ key: 'high' })
  await ui.advance(SETTLE)
  expect(await drawn('sonnet-high')).toBe(false)

  // It folds back from there on the same hold, through the bar to the indicator, with no pause first.
  await clock.advance(HOLD - 1)
  await ui.advance(SETTLE)
  expect(await drawn('opus-high')).toBe(true)
  await clock.advance(1)
  expect(await drawn('opus-high')).toBe(false)
  expect(await inBand({ key: 'bar-high', text: /●/ })).toBeDefined()
  await ui.advance(SETTLE)
  expect(await resting()).toBe(true)

  // A key during the fold carries on from the width already drawn, in either direction.
  await $.command.run({ command: 'dot-right' })
  await ui.advance(SETTLE)
  await clock.advance(HOLD)
  await ui.advance(16)

  const shrinking = await barWidth()

  expect(shrinking).toBeLessThan(45)
  expect(shrinking).toBeGreaterThan(0)
  await $.command.run({ command: 'dot-left' })
  expect(await barWidth()).toBe(shrinking)
  await ui.advance(16)
  expect(await barWidth()).toBeGreaterThanOrEqual(shrinking)
  await ui.advance(SETTLE)
  expect(await drawn('opus-high')).toBe(true)
  await clock.advance(HOLD)
  await ui.advance(SETTLE)
  expect(await resting()).toBe(true)

  // A model key draws the moved dot in its own frame, the bar stretching and then the grid
  // unfolding, nearest rows first.
  await $.command.run({ command: 'dot-down' })
  expect(await inBand({ key: 'indicator', text: /sonnet/ })).toBeDefined()
  expect(await inBand({ key: 'bar-high', text: /●/ })).toBeDefined()
  expect(await resting()).toBe(false)

  const order: string[] = []

  for (let frame = 0; frame < 40; frame++) {
    await ui.advance(16)

    for (const row of ['sonnet', 'opus', 'haiku', 'fable']) {
      if (!order.includes(row) && (await drawn(`${row}-high`))) order.push(row)
    }
  }

  expect(order).toEqual(['sonnet', 'opus', 'haiku', 'fable'])
  expect(await inBand({ key: 'sonnet-high', text: /●/ })).toBeDefined()
  await nothingToClick()

  // An effort key before the hold ends starts it over, and leaves the open rows drawn.
  await clock.advance(1000)
  await $.command.run({ command: 'dot-right' })
  await clock.advance(HOLD - 100)
  await ui.advance(SETTLE)
  expect(await drawn('fable-high')).toBe(true)

  // An effort key halfway through the fold holds the rows still drawn, and the dot never waits.
  await clock.advance(100)
  await ui.advance(16)

  const holding = await openRows()

  expect(holding).not.toContain('fable')
  await $.command.run({ command: 'dot-left' })
  expect(await inBand({ key: 'sonnet-high', text: /●/ })).toBeDefined()
  await ui.advance(SETTLE)
  expect(await openRows()).toEqual(expect.arrayContaining(holding))
  expect(await openRows()).not.toContain('fable')

  // A model key halfway through the fold opens again from there.
  await clock.advance(HOLD)
  await $.command.run({ command: 'dot-up' })
  await ui.advance(SETTLE)
  expect(await drawn('haiku-high')).toBe(true)

  // Left alone it folds away completely.
  await clock.advance(HOLD)
  await ui.advance(SETTLE)
  expect(await resting()).toBe(true)
  expect(await drawn('opus-high')).toBe(false)

  // The grid waits for a dialog however long it stays up.
  messages.push({ role: 'assistant', text: 'ok', toolUses: [] })

  const moving = $.command.run({ command: 'dot-up' })

  await clock.advance(HOLD + 60000)
  await ui.advance(SETTLE)
  expect(asks.length).toBe(1)
  expect(await drawn('haiku-high')).toBe(true)

  asks[0]!()
  await moving
  await clock.advance(HOLD)
  await ui.advance(SETTLE)
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

  for (const bodyColumns of [200, 79, 45, 29]) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns } })
    const cellsOf = (row: string) => Promise.all(LEVELS.map(async key => (await ui.find({ key: `${row}-${key}`, in: 'band' }))!.text))

    // The dot starts on its column in the bar's first frame. Up opens the grid even at the top.
    await $.command.run({ command: 'dot-up' })
    expect(await ui.find({ key: 'bar-xhigh', text: /●/, in: 'band' })).toBeDefined()
    await ui.advance(SETTLE)

    const cells = await cellsOf('fable')

    expect('fable  '.length + cells.join('').length + ' xhigh'.length).toBeLessThanOrEqual(bodyColumns)
    expect(cells.join('').replace(/[ ━─]/g, '')).toBe('···●·')
    // Filled up to the dot, plain after it.
    if (bodyColumns >= 79) {
      expect(cells[3]).toContain('━●─')
      expect(cells[2]).not.toContain('─')
      expect(cells[4]).not.toContain('━')
    }

    // Every row keeps the selected row's columns.
    expect((await cellsOf('opus')).map(cell => cell.length)).toEqual(cells.map(cell => cell.length))

    await clock.advance(HOLD)
    await ui.advance(SETTLE)
    await ui.unmount()
  }

  // The /effort slider's colors, with a rainbow step for each of max's columns and letters.
  const ui = await $.ui.mount(BAND)
  const find = (text: RegExp) => ui.find({ type: 'Text', text, in: 'band' })
  const COLORS = [
    ['low', 'warning'],
    ['medium', 'success'],
    ['high', 'permission'],
    ['xhigh', 'autoAccept'],
    ['max', 'rainbow_blue'],
  ] as const

  for (const [level, color] of COLORS) {
    await ui.press({ key: level })
    await ui.advance(SETTLE)
    expect((await find(/^●$/))?.props.color).toBe(color)
  }

  expect((await find(/^━+$/))?.props.color).toBe('rainbow_red')
  expect((await find(/^m$/))?.props.color).toBe('rainbow_red')
  expect((await find(/^x$/))?.props.color).toBe('rainbow_yellow')

  await clock.advance(HOLD)
  await ui.advance(SETTLE)
  expect(await find(/●/)).toBeUndefined()
  await ui.unmount()
})

test('with reduced motion the band jumps to each state, with no frames between', async ($, on) => {
  const clock = mock.clock(on)

  on('session.messages', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('env.set', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high', prefersReducedMotion: true } }))
  on('command.run', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  const drawn = async (key: string) => (await ui.find({ key, in: 'band' })) !== undefined

  await $.command.run({ command: 'dot-right' })
  expect(await ui.find({ key: 'opus-xhigh', text: /●/, in: 'band' })).toBeDefined()
  expect(await drawn('fable-high')).toBe(false)

  await $.command.run({ command: 'dot-down' })
  expect(await drawn('fable-high')).toBe(true)

  await clock.advance(HOLD)
  expect((await ui.find({ key: 'indicator', in: 'band' }))!.text).toBe('sonnet xhigh')
  await ui.unmount()
})

test('/model and the picker beat the dot from before the first request on, and only they do', async ($, on) => {
  const sent: string[] = []
  // As the engine can have it: the session's model with a suffix, a request's without.
  let session = 'claude-opus-5-5[1m]'
  const clock = mock.clock(on)

  on('session.messages', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: session }))
  on('settings.read', () => ({ value: { effortLevel: 'high', prefersReducedMotion: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('turn.step', async function* (_, e) {
    sent.push(e.model)

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  const request = async (index: number) => {
    for await (const _ of $.turn.step({ turnId: 't', index, model: session.replace('[1m]', ''), messageCount: 1 })) {
    }
  }

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  const indicator = async () => (await ui.find({ key: 'indicator', in: 'band' }))!.text

  // /model before the first request: that request goes out on it, and the dot follows.
  session = 'claude-sonnet-5-5[1m]'
  await request(0)
  expect(sent).toEqual(['claude-sonnet-5-5'])
  expect(await indicator()).toBe('sonnet high')

  // A dot move holds across requests, though they name the model in another form.
  await $.command.run({ command: 'dot-down' })
  await clock.advance(HOLD)
  await request(1)
  await request(2)
  expect(sent.slice(1)).toEqual(['haiku', 'haiku'])
  expect(await indicator()).toBe('haiku high')

  // /model later on wins the same way.
  session = 'claude-opus-5-5[1m]'
  await request(3)
  expect(sent[3]).toBe('claude-opus-5-5')
  expect(await indicator()).toBe('opus high')
  await ui.unmount()
})

test('with no effort known yet, the indicator is the model alone', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ key: 'indicator', in: 'band' }))!.text).toBe('opus')
  await ui.unmount()
})
