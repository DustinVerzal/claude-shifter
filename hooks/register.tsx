import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, Model } from '../types'

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// Strongest first, so shift+up moves the dot up to a stronger model.
const MODELS: readonly Model[] = ['fable', 'opus', 'sonnet', 'haiku']
const HEAT = { low: 'success', medium: 'success', high: 'warning', xhigh: 'error', max: 'error' } as const
const ARROWS = ['left', 'right', 'up', 'down'] as const

const LABEL = 7
const CELL = 7

const center = (text: string) =>
  text.padStart(Math.floor((CELL + text.length) / 2)).padEnd(CELL)
const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort)
const modelOf = (id: string) => MODELS.find(m => id.includes(m)) ?? null

const effort = atom({ plugin: 'effort-keys', key: 'effort' } as const, null)
const model = atom({ plugin: 'effort-keys', key: 'model' } as const, null)

// An atom, not a variable: writing it has to redraw the Spinner hook that reads it.
const turnRunning = atom({ plugin: 'effort-keys', key: 'turnRunning' } as const, false)

let warned = false
// The model the engine last asked for, to notice /model or the picker moving it.
let engineModel: string | null = null

// The engine's own session override. /effort always prints to the transcript and
// writes settings.json; this does neither.
async function setEffort($: EngineInterface, target: Effort) {
  await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', target)
  await update($, effort, () => target)
}

async function setModel($: EngineInterface, target: Model) {
  if (target === (await read($, model))) return

  // Prompt caches are per model. Once per burst of presses, so a held arrow cannot stack toasts.
  if (!warned && (await $.session.turns()) > 0) {
    warned = true
    $.ui.toast('Model changed mid-session: the prompt cache starts over, so the next request costs more')
  }

  await update($, model, () => target)
}

async function select($: EngineInterface, row: Model, column: Effort) {
  await setEffort($, column)
  await setModel($, row)
}

async function moveDot($: EngineInterface, arrow: (typeof ARROWS)[number]) {
  if (arrow === 'left' || arrow === 'right') {
    const from = EFFORTS.indexOf((await read($, effort)) ?? 'high')
    const target = EFFORTS[from + (arrow === 'right' ? 1 : -1)]

    if (target) await setEffort($, target)
  } else {
    const from = MODELS.indexOf((await read($, model)) ?? 'opus')
    const target = MODELS[from + (arrow === 'down' ? 1 : -1)]

    if (target) await setModel($, target)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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

  // Shift+arrows can only be command: bindings (a shift-only key cannot press a mod's
  // Button), and those draw an echo and a spinner for a frame, so both are hidden below.
  for (const arrow of ARROWS) {
    on('command.run', { command: `dot-${arrow}` }, async $ => {
      await moveDot($, arrow)

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
    warned = false

    const sent = e.effort

    if (isEffort(sent)) await update($, effort, () => sent)

    // /model or the picker moved the session: that choice wins over the dot.
    if (engineModel !== null && e.model !== engineModel) {
      await update($, model, () => modelOf(e.model))
    }

    engineModel = e.model

    // The engine keeps no live setter for this, and /model prints and writes settings.
    // ponytail: the footer and subagents stay on the session's model; only main requests move.
    const row = await read($, model)

    if (row && row !== modelOf(e.model)) return yield* next({ ...e, model: row })

    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const [currentEffort, currentModel] = [await read($, effort), await read($, model)]
    const x = currentEffort ? EFFORTS.indexOf(currentEffort) : -1
    const y = currentModel ? MODELS.indexOf(currentModel) : -1

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text>{' '.repeat(LABEL)}</Text>
          {EFFORTS.map((level, column) => (
            // ctrl+1..5 in keybindings.json: strip:jump* has no handler in a normal session.
            // ponytail: undocumented actions; if a release starts handling them, pick other free ones.
            <Button
              key={level}
              label={level}
              plain
              action={`strip:jump${column + 1}`}
              onPress={() => setEffort($, level)}
            >
              {column === x ? (
                <Text bold color={HEAT[level]}>{center(level)}</Text>
              ) : (
                <Text dimColor>{center(level)}</Text>
              )}
            </Button>
          ))}
        </Box>
        {MODELS.map((name, row) => (
          <Box key={name} flexDirection="row">
            {row === y ? <Text bold>{name.padEnd(LABEL)}</Text> : <Text dimColor>{name.padEnd(LABEL)}</Text>}
            {EFFORTS.map((level, column) => (
              <Button
                key={`${name}-${level}`}
                label={`${name} at ${level}`}
                plain
                onPress={() => select($, name, level)}
              >
                {row === y && column === x ? (
                  <Text bold color={HEAT[level]}>{center('●')}</Text>
                ) : (
                  <Text dimColor>{center('·')}</Text>
                )}
              </Button>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
