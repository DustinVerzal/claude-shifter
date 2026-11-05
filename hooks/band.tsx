import type { ClientModule } from 'claude-code'

import type { Effort, Model } from '../types'

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// Strongest first, so shift+up moves the dot up to a stronger model.
export const MODELS: readonly Model[] = ['fable', 'opus', 'sonnet', 'haiku']
// ponytail: hand-kept, since the engine only names the session's own model. Update on a model release.
const VERSIONS: Record<Model, string> = { fable: '5.1', opus: '5.5', sonnet: '5.5', haiku: '5.5' }
// The /effort slider's own colors. It animates xhigh and max; here they hold still, since this
// sits above the prompt all session.
const COLORS = { low: 'warning', medium: 'success', high: 'permission', xhigh: 'autoAccept' } as const
// The engine's order for max and ultrathink. The ThemeKey type omits these keys, but they resolve.
// ponytail: undocumented keys, checked on 2.1.318; if a release drops them, max needs other colors.
const RAINBOW = ['rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue', 'rainbow_indigo', 'rainbow_violet'] as const
const colorOf = (level: Effort, step: number) => (level === 'max' ? RAINBOW[step % RAINBOW.length] : COLORS[level])

const LABEL = 'sonnet '.length
const VERSIONED_LABEL = 'sonnet 5.5 '.length
const WORD = ' medium'.length
const CELL_MIN = 3
const CELL_MAX = 9

// The engine writes about 60 frames a second, and a $.state write redraws at 30 at most. So this
// runs on the surface's own frame clock, and the hooks only hand it how far to open.
const FRAME = 16
// How quickly the bar eases to its goal, in ms: about 4.6 of these to settle.
const STRETCH = 40
const SHRINK = 25
// A row is a whole terminal row, so rows step rather than ease, in ms each. Whole frames, so they
// land evenly.
const UNFOLD = FRAME * 2
const FOLD = FRAME
// How far the bar opens before rows start, so they don't land on cells still stretching.
const BAR_READY = 0.85
// Close enough to finish: within a column of the widest bar, so its tail doesn't tick on alone.
const SETTLED = 0.02

const center = (text: string, width: number) =>
  text.padStart(Math.floor((width + text.length) / 2)).padEnd(width)

export type BandProps = {
  effort: Effort | null
  model: Model | null
  // How far to open, in rows out from the selected one. 0 is the indicator.
  reach: number
  bodyColumns: number
  // prefersReducedMotion: jump to the goal.
  still: boolean
}

// bar: 0 is the indicator and 1 the bar at full width. rows: how many rows out from the selected
// one are open, where 0 is the bar alone.
type Motion = { bar: number; rows: number; reach: number; last: number; stop: (() => void) | null }

// An exponential ease-out holds no start or end time, so a key at any moment carries on from
// what is drawn, in either direction.
const ease = (from: number, to: number, ms: number, tau: number) => {
  const next = to + (from - to) * Math.exp(-ms / tau)

  return Math.abs(to - next) < SETTLED ? to : next
}
const step = (from: number, to: number, by: number) => (from < to ? Math.min(from + by, to) : Math.max(from - by, to))

function advance(m: Motion, ms: number) {
  if (m.reach === 0) {
    m.rows = step(m.rows, 0, ms / FOLD)

    if (m.rows <= 1) m.bar = ease(m.bar, 0, ms, SHRINK)
  } else {
    m.bar = ease(m.bar, 1, ms, STRETCH)

    // Never below what is drawn: an effort key during the fold holds the rows still open.
    if (m.bar > BAR_READY) m.rows = step(m.rows, Math.max(m.reach, m.rows), ms / UNFOLD)
  }
}

const settled = (m: Motion) => (m.reach === 0 ? m.bar === 0 && m.rows === 0 : m.bar === 1 && m.rows >= m.reach)

const Band: ClientModule<BandProps, Motion> = (props, s) => {
  const m = s.state ?? { bar: 0, rows: 0, reach: 0, last: 0, stop: null }

  m.reach = props.reach

  if (props.still) {
    m.stop?.()
    m.stop = null
    advance(m, Infinity)
  } else if (!m.stop && !settled(m)) {
    // The first frame is drawn by the keypress itself.
    advance(m, FRAME)
    m.last = Date.now()
    // Stopped once settled, so the band costs nothing at rest.
    m.stop = s.every(FRAME, () => {
      const current = s.state!
      const now = Date.now()

      // Elapsed time, so dropped frames don't stretch the motion, but a stall can't leap it either.
      advance(current, Math.min(Math.max(now - current.last, FRAME), FRAME * 3))
      current.last = now

      if (settled(current)) {
        current.stop?.()
        current.stop = null
      }

      s.setState({ ...current })
    })
  }

  if (s.state === undefined) s.setState(m)

  const { Box, Text } = s.elements
  const { effort, model, bodyColumns } = props
  const x = effort ? EFFORTS.indexOf(effort) : -1
  const y = model ? MODELS.indexOf(model) : -1
  const name = model ?? '?'

  // /effort colors max letter by letter. Padding takes no step, so it starts on red at any width.
  const spell = (level: Effort, text: string) => {
    const lead = text.length - text.trimStart().length

    return [...text].map((letter, i) => <Text key={String(i)} color={colorOf(level, Math.max(i - lead, 0))}>{letter}</Text>)
  }
  const word = effort ? <Text bold>{spell(effort, ` ${effort}`)}</Text> : null

  if (m.bar === 0) {
    return <Box key="indicator"><Text><Text bold>{name}</Text>{word}</Text></Box>
  }

  // Versions give way first when the row wouldn't fit even at the narrowest cells.
  const versioned = bodyColumns >= VERSIONED_LABEL + WORD + EFFORTS.length * CELL_MIN
  const labelWidth = versioned ? VERSIONED_LABEL : LABEL
  const full = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((bodyColumns - labelWidth - WORD) / EFFORTS.length)))
  // Stretching the cells keeps the dot drawn from the first frame, on its own column.
  const total = EFFORTS.length + Math.round(EFFORTS.length * (full - 1) * m.bar)
  // Each cell's share of the total, so a frame can add one column where one shared width would add five.
  const widthOf = (column: number) =>
    Math.floor(((column + 1) * total) / EFFORTS.length) - Math.floor((column * total) / EFFORTS.length)
  // A column clear of the name from the first frame, growing to the width every row shares.
  const label = Math.round(name.length + 1 + (labelWidth - name.length - 1) * m.bar)
  // Cut to the growing column, so the version arrives with the stretch and no row pushes the cells.
  const title = (row: Model | null) =>
    (row && versioned ? `${row} ${VERSIONS[row]}` : row ?? name).slice(0, label - 1).padEnd(label)

  // The selected row is one track, the same in the bar and in the grid, so opening the names
  // and rows moves nothing sideways: the line fills up to the dot.
  const track = (key: string, column: number) => {
    const cell = widthOf(column)
    const lead = Math.floor((cell - 1) / 2)
    const color = effort ? colorOf(effort, column) : undefined
    const rail = (length: number, filled: boolean, end: boolean) => {
      const run = (end ? ' ' : filled ? '━' : '─').repeat(length)

      return filled ? <Text color={color}>{run}</Text> : <Text dimColor>{run}</Text>
    }

    return (
      <Box key={key}>
        <Text>
          {rail(lead, column <= x, column === 0)}
          {column === x ? (
            <Text bold color={color}>●</Text>
          ) : column < x ? (
            <Text color={color}>·</Text>
          ) : (
            <Text dimColor>·</Text>
          )}
          {rail(cell - 1 - lead, column < x, column === EFFORTS.length - 1)}
        </Text>
      </Box>
    )
  }

  if (m.rows === 0) {
    return (
      <Box flexDirection="row">
        <Box key="indicator"><Text bold>{title(model)}</Text></Box>
        {EFFORTS.map((level, column) => track(`bar-${level}`, column))}
        {word}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text>{' '.repeat(label)}</Text>
        {EFFORTS.map((level, column) => {
          const cell = widthOf(column)

          return column === x ? (
            <Text key={`name-${level}`} bold>{spell(level, center(level.slice(0, cell - 1), cell))}</Text>
          ) : (
            <Text key={`name-${level}`} dimColor>{center(level.slice(0, cell - 1), cell)}</Text>
          )
        })}
      </Box>
      {MODELS.map((row, index) =>
        y >= 0 && Math.abs(index - y) >= m.rows ? null : (
          <Box key={row} flexDirection="row">
            {index === y ? (
              <Text bold>{title(row)}</Text>
            ) : (
              <Text dimColor>{title(row)}</Text>
            )}
            {EFFORTS.map((level, column) =>
              index === y ? (
                track(`${row}-${level}`, column)
              ) : (
                <Box key={`${row}-${level}`}><Text dimColor>{center('·', widthOf(column))}</Text></Box>
              ),
            )}
            {index === y ? word : null}
          </Box>
        ),
      )}
    </Box>
  )
}

export default Band
