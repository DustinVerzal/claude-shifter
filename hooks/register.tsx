import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Effort, Model } from '../types'

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// Strongest first, so shift+up moves the dot up to a stronger model.
const MODELS: readonly Model[] = ['fable', 'opus', 'sonnet', 'haiku']
// The /effort slider's own colors. It animates xhigh and max; here they hold still, since this
// sits above the prompt all session and every animation shares one timer (wait).
const COLORS = { low: 'warning', medium: 'success', high: 'permission', xhigh: 'autoAccept' } as const
// The engine's order for max and ultrathink. The ThemeKey type omits these keys, but they resolve.
// ponytail: undocumented keys, checked on 2.1.318; if a release drops them, max needs other colors.
const RAINBOW = ['rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue', 'rainbow_indigo', 'rainbow_violet'] as const
const colorOf = (level: Effort, step: number) => (level === 'max' ? RAINBOW[step % RAINBOW.length] : COLORS[level])
const ARROWS = ['left', 'right', 'up', 'down'] as const

const LABEL = 7
const WORD = ' medium'.length
const CELL_MIN = 3
const CELL_MAX = 9

// Terminal frames, so these are coarse. The first frame is drawn by the keypress itself.
const FRAME = 40
const HOLD = 1200
const FADE = 150
const CLOSED = { shown: 0, fading: false }
// Frames the bar takes to stretch open from the indicator.
const BAR = 4
// How far an effort change opens: the effort names over the selected model's row.
const STRIP = BAR + 1
const GRID = BAR + MODELS.length

const center = (text: string, width: number) =>
  text.padStart(Math.floor((width + text.length) / 2)).padEnd(width)
const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort)
const modelOf = (id: string) => MODELS.find(m => id.includes(m)) ?? null

const effort = atom({ plugin: 'effortless', key: 'effort' } as const, null)
const model = atom({ plugin: 'effortless', key: 'model' } as const, null)

// An atom, not a variable: writing it has to redraw the Spinner hook that reads it.
const turnRunning = atom({ plugin: 'effortless', key: 'turnRunning' } as const, false)

// shown: 0 is the indicator; up to BAR, the bar stretching open; above it, the grid out to
// shown - BAR rows from the selected one.
const motion = atom({ plugin: 'effortless', key: 'motion' } as const, CLOSED)

// /clear empties $.state under a new session id, even what session.end wrote, and fires
// no session.start. Module variables outlive it, so the selection is kept here.
// ponytail: a hot reload resets this, which only matters if /clear came before it.
let kept: { effort: Effort | null; model: Model | null } = { effort: null, model: null }
const currentEffort = async ($: EngineInterface) => (await read($, effort)) ?? kept.effort
const currentModel = async ($: EngineInterface) => (await read($, model)) ?? kept.model

let agreed = false
let asking = false
// The model the engine last asked for, to notice /model or the picker moving it.
let engineModel: string | null = null

// One timer, so opening, holding, fading and folding can never run over each other,
// and a keypress in any of them carries on from the rows already drawn.
let timer: Timer | undefined

function wait($: EngineInterface, ms: number, fn: () => void) {
  timer?.cancel()
  timer = $.clock.after(ms, fn)
}

async function reveal($: EngineInterface, reach = GRID) {
  timer?.cancel()

  const drawn = (await read($, motion)).shown
  // Never below what is drawn: an effort key on an open grid holds it instead of snapping it shut.
  // ponytail: an effort key during a model key's opening frames stops the rows there; carry the reach over if that shows.
  const shown = Math.max(drawn, Math.min(drawn + 1, reach))

  await update($, motion, () => ({ shown, fading: false }))

  if (shown < reach) wait($, FRAME, () => reveal($, reach))
  else wait($, HOLD, () => fade($))
}

async function fade($: EngineInterface) {
  // The dialog's answer reveals again; the person is still deciding on what the grid shows.
  if (asking) return

  await update($, motion, current => ({ ...current, fading: true }))
  wait($, FADE, () => fold($))
}

async function fold($: EngineInterface) {
  const shown = Math.max((await read($, motion)).shown - 1, 0)

  await update($, motion, () => ({ shown, fading: shown > 0 }))

  if (shown > 0) wait($, FRAME, () => fold($))
}

// Together, so the grid never opens for a frame on the old value. A dialog keeps action
// pending, which is why it cannot simply go first.
async function press($: EngineInterface, action: () => Promise<unknown>, reach?: number) {
  await Promise.all([reveal($, reach), action()])
}

// The engine's own session override. /effort always prints to the transcript and
// writes settings.json; this does neither.
async function setEffort($: EngineInterface, target: Effort) {
  await update($, effort, () => target)
  await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', target)
}

// Resolves to whether the dot moved: nothing changes until the person agrees.
async function setModel($: EngineInterface, target: Model) {
  const current = await currentModel($)

  if (target === current) return true

  // Prompt caches are per model. Only the next request pays, so one yes covers
  // every move until then, and a held arrow cannot stack dialogs behind the open one.
  // A reply means a request went out; session.turns also counts /clear's row as a prompt.
  // ponytail: a move during the very first request goes unasked; that cache holds one prompt.
  if (!agreed && (await $.session.messages()).some(m => m.role === 'assistant')) {
    if (asking) return false

    asking = true

    const yes = `Switch to ${target}`
    const answer = await $.ui
      .ask(`Switch to ${target}? Prompt caches are per model, so the next request re-reads the whole conversation and costs more.`, {
        header: 'Model',
        options: [yes, `Keep ${current ?? 'current model'}`],
      })
      .catch(() => null) // Dismissed: the same as keeping the model.
      .finally(() => {
        asking = false
        void reveal($)
      })

    if (answer !== yes) return false

    agreed = true
  }

  await update($, model, () => target)

  return true
}

async function moveDot($: EngineInterface, arrow: (typeof ARROWS)[number]) {
  if (arrow === 'left' || arrow === 'right') {
    const from = EFFORTS.indexOf((await currentEffort($)) ?? 'high')
    const target = EFFORTS[from + (arrow === 'right' ? 1 : -1)]

    if (target) await setEffort($, target)
  } else {
    const from = MODELS.indexOf((await currentModel($)) ?? 'opus')
    const target = MODELS[from + (arrow === 'down' ? 1 : -1)]

    if (target) await setModel($, target)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A reload drops the timer that would have folded a grid left open.
    await update($, motion, () => CLOSED)

    const id = await $.session.model()
    const { effortLevel, modelSettings } = await $.settings.read()
    const perModel = modelSettings as Record<string, { effortLevel?: unknown }> | undefined
    const saved = perModel?.[id.replace(/\[.*\]$/, '')]?.effortLevel ?? effortLevel

    await update($, model, current => current ?? modelOf(id))

    // ponytail: seed from what is saved, since no call reads the live level; turn.step corrects it.
    if (isEffort(saved)) await update($, effort, current => current ?? saved)

    for (const arrow of ARROWS) {
      await $.command.register({ name: `dot-${arrow}`, description: `Move the dot ${arrow}`, immediate: true })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    kept = { effort: await currentEffort($), model: await currentModel($) }

    return next(e)
  })

  // Shift+arrows can only be command: bindings (a shift-only key cannot press a mod's
  // Button), and those draw an echo and a spinner for a frame, so both are hidden below.
  for (const arrow of ARROWS) {
    on('command.run', { command: `dot-${arrow}` }, async $ => {
      await press($, () => moveDot($, arrow), arrow === 'left' || arrow === 'right' ? STRIP : undefined)

      return {}
    })
  }

  // Slash commands skip prompt.submit, so this tells a real turn from a keypress's frame.
  on('prompt.submit', async ($, e, next) => {
    await update($, turnRunning, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, turnRunning, () => false)

    return next(e)
  })

  // ponytail: hides every spinner outside a turn, not only the keypress's; narrow it if one is missed.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (await read($, turnRunning)) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (!/^\/dot-/.test(e.props.text)) return next(e)

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  // A typed /effort takes back control; with our override set it could only report being overridden.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const typed = e.args.trim()

    await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', undefined)

    if (isEffort(typed)) await update($, effort, () => typed)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)

    // Also covers turns no prompt started, such as a background task's notification.
    await update($, turnRunning, () => true)
    agreed = false

    const sent = e.effort

    if (isEffort(sent)) await update($, effort, () => sent)

    // /model or the picker moved the session: that choice wins over the dot.
    if (engineModel !== null && e.model !== engineModel) {
      await update($, model, () => modelOf(e.model))
    }

    engineModel = e.model

    // The engine keeps no live setter for this, and /model prints and writes settings.
    // ponytail: subagents stay on the session's model; only main requests move.
    const row = await currentModel($)

    if (row && row !== modelOf(e.model)) return yield* next({ ...e, model: row })

    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const [shownEffort, shownModel] = [await currentEffort($), await currentModel($)]
    const { shown, fading } = await read($, motion)
    const x = shownEffort ? EFFORTS.indexOf(shownEffort) : -1
    const y = shownModel ? MODELS.indexOf(shownModel) : -1
    const full = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((e.props.bodyColumns - LABEL - WORD) / EFFORTS.length)))
    // Stretching the cells keeps the dot drawn from the first frame, on its own column.
    const cell = 1 + Math.round(((full - 1) * Math.min(shown, BAR)) / BAR)
    const reach = Math.floor((cell - 1) / 2)

    // The selected row is one track, the same in the bar and in the grid, so opening the names
    // and rows moves nothing sideways: the line fills up to the dot.
    const track = (key: string, column: number) => {
      const color = shownEffort ? colorOf(shownEffort, column) : undefined
      const rail = (length: number, filled: boolean, end: boolean) => {
        const run = (end ? ' ' : filled ? '━' : '─').repeat(length)

        return filled ? <Text color={color}>{run}</Text> : <Text dimColor>{run}</Text>
      }

      return (
        <Box key={key}>
          <Text>
            {rail(reach, column <= x, column === 0)}
            {column === x ? (
              <Text bold color={color}>●</Text>
            ) : column < x ? (
              <Text color={color}>·</Text>
            ) : (
              <Text dimColor>·</Text>
            )}
            {rail(cell - 1 - reach, column < x, column === EFFORTS.length - 1)}
          </Text>
        </Box>
      )
    }
    // /effort colors max letter by letter. Padding takes no step, so it starts on red at any width.
    const spell = (level: Effort, text: string) => {
      const lead = text.length - text.trimStart().length

      return [...text].map((letter, i) => <Text key={String(i)} color={colorOf(level, Math.max(i - lead, 0))}>{letter}</Text>)
    }
    const word = shownEffort ? <Text bold>{spell(shownEffort, ` ${shownEffort}`)}</Text> : null

    // Mounted in every form and always empty: a Button's chord only works while it is drawn, and
    // anything drawn on one would take clicks too. ctrl+1..5 in keybindings.json: strip:jump* has
    // no handler in a normal session.
    // ponytail: undocumented actions; if a release starts handling them, pick other free ones.
    const chords = EFFORTS.map((level, column) => (
      <Button
        key={level}
        label={level}
        plain
        action={`strip:jump${column + 1}`}
        onPress={() => press($, () => setEffort($, level), STRIP)}
      >
        <Text />
      </Button>
    ))
    const name = shownModel ?? '?'

    if (shown === 0) {
      return (
        <Box flexDirection="row">
          <Box key="indicator"><Text><Text bold>{name}</Text>{word}</Text></Box>
          {chords}
        </Box>
      )
    }

    if (shown <= BAR) {
      return (
        <Box flexDirection="row">
          <Box key="indicator"><Text bold>{name.padEnd(LABEL)}</Text></Box>
          {EFFORTS.map((level, column) => track(`bar-${level}`, column))}
          {word}
          {chords}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text>{' '.repeat(LABEL)}</Text>
          {EFFORTS.map((level, column) =>
            column === x && !fading ? (
              <Text key={`name-${level}`} bold>{spell(level, center(level.slice(0, cell - 1), cell))}</Text>
            ) : (
              <Text key={`name-${level}`} dimColor>{center(level.slice(0, cell - 1), cell)}</Text>
            ),
          )}
          {chords}
        </Box>
        {MODELS.map((name, row) =>
          y >= 0 && Math.abs(row - y) >= shown - BAR ? null : (
            <Box key={name} flexDirection="row">
              {row === y ? (
                <Text bold>{name.padEnd(LABEL)}</Text>
              ) : (
                <Text dimColor>{name.padEnd(LABEL)}</Text>
              )}
              {EFFORTS.map((level, column) =>
                row === y ? (
                  track(`${name}-${level}`, column)
                ) : (
                  <Box key={`${name}-${level}`}><Text dimColor>{center('·', cell)}</Text></Box>
                ),
              )}
              {row === y ? word : null}
            </Box>
          ),
        )}
      </Box>
    )
  })
}
