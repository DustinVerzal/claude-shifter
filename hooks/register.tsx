import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, Timer } from 'claude-code'

import { EFFORTS, MODELS } from './band'
import type { BandProps } from './band'
import type { Effort, Model } from '../types'

const ARROWS = ['left', 'right', 'up', 'down'] as const

// Counted from the key, so it includes the opening.
const HOLD = 1400
// How far to open, in rows out from the selected one. An effort change opens only the effort
// names over the selected model's row.
const CLOSED = 0
const STRIP = 1
const GRID = MODELS.length

const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort)
const modelOf = (id: string) => MODELS.find(m => id.includes(m)) ?? null

const effort = atom({ plugin: 'effortless', key: 'effort' } as const, null)
const model = atom({ plugin: 'effortless', key: 'model' } as const, null)

// An atom, not a variable: writing it has to redraw the Spinner hook that reads it.
const turnRunning = atom({ plugin: 'effortless', key: 'turnRunning' } as const, false)

const reach = atom({ plugin: 'effortless', key: 'reach' } as const, CLOSED)

// /clear empties $.state under a new session id, even what session.end wrote, and fires
// no session.start. Module variables outlive it, so the selection is kept here.
// ponytail: a hot reload resets this, which only matters if /clear came before it.
let kept: { effort: Effort | null; model: Model | null } = { effort: null, model: null }
const currentEffort = async ($: EngineInterface) => (await read($, effort)) ?? kept.effort
const currentModel = async ($: EngineInterface) => (await read($, model)) ?? kept.model

let agreed = false
let asking = false
// The session's model as last seen, to notice /model or the picker moving it. Always from
// $.session.model, since a request can name the same model in another form ([1m]).
let engineModel: string | null = null
// ponytail: read when a session starts, so a /config change applies from the next one; read it per press if that shows.
let still = false

// One timer, so a keypress during the hold starts it over. The motion itself runs on the surface.
let timer: Timer | undefined

function wait($: EngineInterface, ms: number, fn: () => void) {
  timer?.cancel()
  timer = $.clock.after(ms, fn)
}

async function reveal($: EngineInterface, to = GRID) {
  // Never below what is open: an effort key on an open grid holds it instead of snapping it shut.
  await update($, reach, current => Math.max(current, to))
  wait($, HOLD, () => close($))
}

async function close($: EngineInterface) {
  // The dialog's answer reveals again; the person is still deciding on what the grid shows.
  if (asking) return

  await update($, reach, () => CLOSED)
}

// Together, so the grid never opens for a frame on the old value. A dialog keeps action
// pending, which is why it cannot simply go first.
async function press($: EngineInterface, action: () => Promise<unknown>, to?: number) {
  await Promise.all([reveal($, to), action()])
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

const KEYS: Record<string, Record<string, string>> = {
  Global: Object.fromEntries(EFFORTS.map((_, column) => [`ctrl+${column + 1}`, `strip:jump${column + 1}`])),
  Chat: Object.fromEntries(ARROWS.map(arrow => [`shift+${arrow}`, `command:dot-${arrow}`])),
}

type KeyBlock = { context?: unknown; bindings?: Record<string, unknown> }

// Adds to what is there, since this file is the person's own: a key they bound to something
// else stays theirs, and an action they already moved to another key stays there.
// ponytail: only looks at Global and Chat, the two contexts a mod's keys can clash in here.
function mergeKeys(blocks: KeyBlock[]) {
  const ours = blocks.filter(block => typeof block?.context === 'string' && block.context in KEYS && block.bindings)
  const bound = ours.flatMap(block => Object.entries(block.bindings!))
  const added: string[] = []
  const taken: string[] = []

  for (const [context, keys] of Object.entries(KEYS)) {
    for (const [key, action] of Object.entries(keys)) {
      if (bound.some(([, existing]) => existing === action)) continue

      const clash = bound.find(([existing]) => existing === key)

      if (clash) {
        taken.push(`${key} is bound to ${clash[1]}, so ${action} needs another key`)
        continue
      }

      let block = ours.find(candidate => candidate.context === context)

      if (!block) {
        block = { context, bindings: {} }
        ours.push(block)
        blocks.push(block)
      }

      block.bindings![key] = action
      added.push(key)
    }
  }

  return { added, taken }
}

async function installKeys($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const path = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`}/keybindings.json`
  let file: { bindings?: KeyBlock[] } = { bindings: [] }

  // Anything unreadable stays untouched: writing here would lose the person's bindings.
  try {
    if (await $.fs.exists(path)) file = JSON.parse(await $.fs.read(path))

    if (!Array.isArray(file?.bindings)) throw new Error('it has no "bindings" array')

    const { added, taken } = mergeKeys(file.bindings)

    if (added.length) await $.fs.write(path, `${JSON.stringify(file, null, 2)}\n`)

    const summary = added.length
      ? `Added ${added.join(', ')} to ${path}. Restart Claude Code to use them.`
      : `Nothing to add to ${path}.`

    return { text: [summary, ...taken].join('\n'), exitCode: taken.length ? 1 : 0 }
  } catch (error) {
    return { text: `Left ${path} alone: ${(error as Error).message}. Fix it and run /effortless-keys again.`, exitCode: 1 }
  }
}

export const register: Register = on => {
  on('command.run', { command: 'effortless-keys' }, $ => installKeys($))

  on('session.start', async ($, e, next) => {
    // A reload drops the timer that would have folded a grid left open.
    await update($, reach, () => CLOSED)

    const id = await $.session.model()
    const { effortLevel, modelSettings, prefersReducedMotion } = await $.settings.read()
    const perModel = modelSettings as Record<string, { effortLevel?: unknown }> | undefined
    const saved = perModel?.[id.replace(/\[.*\]$/, '')]?.effortLevel ?? effortLevel

    still = prefersReducedMotion === true
    // Seeded here, so a /model before the first request counts too.
    engineModel = id

    await update($, model, current => current ?? modelOf(id))

    // ponytail: seed from what is saved, since no call reads the live level; turn.step corrects it.
    if (isEffort(saved)) await update($, effort, current => current ?? saved)

    for (const arrow of ARROWS) {
      await $.command.register({ name: `dot-${arrow}`, description: `Move the dot ${arrow}`, immediate: true })
    }

    await $.command.register({ name: 'effortless-keys', description: 'Add the effortless keys to keybindings.json' })

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
    // ponytail: noticed at the next request, so a dot move made after /model but before that request loses to it.
    const session = await $.session.model()

    if (engineModel !== null && session !== engineModel) {
      await update($, model, () => modelOf(session))
    }

    engineModel = session

    // The engine keeps no live setter for this, and /model prints and writes settings.
    // ponytail: subagents stay on the session's model; only main requests move.
    const row = await currentModel($)

    if (row && row !== modelOf(e.model)) return yield* next({ ...e, model: row })

    return yield* next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    // The band is raised on these two only, and mobile is the surface without a Client.
    const { Box, Button, Client, Text } = $.ui.resolve(e) as Elements['terminal' | 'desktop']
    const props: BandProps = {
      effort: await currentEffort($),
      model: await currentModel($),
      reach: await read($, reach),
      bodyColumns: e.props.bodyColumns,
      still,
    }

    // Beside the band, not in it, and always empty: a Button's chord only works while it is drawn,
    // and anything drawn on one would take clicks too. ctrl+1..5 in keybindings.json: strip:jump*
    // has no handler in a normal session.
    // ponytail: undocumented actions; if a release starts handling them, pick other free ones.
    return (
      <Box flexDirection="row">
        <Client key="band" module="./band.tsx" props={props} />
        {EFFORTS.map((level, column) => (
          <Button
            key={level}
            label={level}
            plain
            action={`strip:jump${column + 1}`}
            onPress={() => press($, () => setEffort($, level), STRIP)}
          >
            <Text />
          </Button>
        ))}
      </Box>
    )
  })
}
