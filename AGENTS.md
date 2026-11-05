# AGENTS.md

`effortless` is a Claude Code mod that draws the model and effort above the prompt, as just `opus high` until they're being changed. Shift+left/right or ctrl+1..5 stretch open the effort bar, and shift+up/down also unfold the model grid. There's no mouse input, on purpose. Changes stay out of the transcript and `settings.json`.

## Layout

| Path | Holds |
| --- | --- |
| `hooks/register.tsx` | The hooks: the selection, the keys, the hold, and asking before a model switch |
| `hooks/band.tsx` | The drawing and all its motion, as a `Client` surface module, plus `EFFORTS` and `MODELS` |
| `types/index.d.ts` | `Effort` and `Model` types, and the `$.state` contract (`PluginState`) |
| `effort.test.tsx` | Tests |
| `hooks/hooks.json` | Points the engine at `register.tsx` |
| `.claude-plugin/plugin.json`, `marketplace.json` | Manifests |
| `.github/workflows/ci.yml` | The checks below on every PR and push to `main`, then the release |
| `.claude-plugin/types/` | Engine API types, generated and gitignored. Grep `claude-code/index.d.ts` for any event, `$` method, or element prop. |

Neither module has DOM or Node. Everything outside the hooks goes through `$`. The surface module has no `$`, and draws from its props and its own state.

## Commands

Run the first three before calling a change done:

```sh
claude plugin validate .      # What the engine would refuse; checks $.state keys against the contract
claude plugin test .          # Runs effort.test.tsx
bunx -p typescript tsc -p .   # Type-check (tsc isn't a dependency of this repo)
claude --plugin-dir .         # Run the mod; saving a file hot-reloads it
```

- `validate` lists a missing icon. That only blocks a plugin directory submission, and validation still passes.
- `tsconfig.json` extends the generated types, so on a fresh clone `tsc` fails until the mod has loaded once with `--plugin-dir`.
- `tsc` covers `hooks/` and `types/` but not `effort.test.tsx`, because the generated config includes `tests/` and the test file sits at the root. `claude plugin test` doesn't report type errors in it, so check test types by hand if you change them.
- The tests don't cover real key presses or terminal drawing. Check those by running the mod.

## Versioning

`main` is what people install, and an installed copy only updates when `version` in `plugin.json` changes. So merging a bump is the release, and CI fails a change to `hooks/` or `types/` that doesn't bump it. Docs and tests don't need one.

- Patch: a fix.
- Minor: new behaviour.
- Major: something people have to act on, such as a change to the keybindings they copied.

Once the checks pass on `main`, CI tags a new version `effortless--v<version>` and creates its GitHub release. Don't tag by hand. Set `version` only in `plugin.json`, because the marketplace entry's value would be ignored.

## Keybindings

A mod can't register a chord, so the keys have to live in `~/.claude/keybindings.json`. `/effortless-keys` merges them from `KEYS` in `register.tsx`, and never overwrites another binding or a file it can't parse. It only adds, so anyone who ran it needs a major version to hear about a changed key. It writes these:

```json
{
  "bindings": [
    {
      "context": "Global",
      "bindings": {
        "ctrl+1": "strip:jump1",
        "ctrl+2": "strip:jump2",
        "ctrl+3": "strip:jump3",
        "ctrl+4": "strip:jump4",
        "ctrl+5": "strip:jump5"
      }
    },
    {
      "context": "Chat",
      "bindings": {
        "shift+left": "command:dot-left",
        "shift+right": "command:dot-right",
        "shift+up": "command:dot-up",
        "shift+down": "command:dot-down"
      }
    }
  ]
}
```

`strip:jump*` is an undocumented action with no handler in a normal session. If a release starts handling it, pick other free actions.

## Rules the code depends on

**Keep selection changes silent.** `/effort` and `/model` print to the transcript and write settings, so the mod avoids both:

- Effort is set with `$.env.set('CLAUDE_CODE_EFFORT_LEVEL', ...)`.
- Model is set by rewriting `e.model` in the `turn.step` hook, for main requests only. Subagents and the engine's own model name stay on the session's model.

**Choices made outside the grid win.** A typed `/effort` clears the env override, and `/model` or the picker moves the dot at the next request, which `turn.step` notices by comparing `$.session.model()` with its last value. Don't compare it with `e.model`, because a request can name the same model in another form.

**Ask before switching models.** Prompt caches are per model, so `setModel` confirms with `$.ui.ask` once the conversation has a reply, and changes nothing unless the person agrees. One yes covers every move until the next request (`agreed`), `asking` stops a held arrow from stacking dialogs, and effort changes never ask.

**Know where state lives:**

- Anything a drawing reads goes in an `atom`, since writing one redraws its readers. Declare each key in `types/index.d.ts`.
- `/clear` empties `$.state` and fires no `session.start`, so read the selection with `currentEffort` and `currentModel`, which fall back to `kept`. Don't call `read($, effort)` directly.
- Module variables survive `/clear` but not a hot reload. A reload runs `register` and `session.start` again, while `$.state` carries over, so new code can meet old values.
- Render hooks can't write state. Write from a handler or another event, using `update`.

**Keep motion on the surface.** A `$.state` write redraws at 30 a second at most, while a surface draws at about 60, so `band.tsx` animates on its own `surface.every(FRAME)` and the hooks only write `reach`. Don't write state per frame.

- `reach` is how far to open, in rows out from the selected one: `0` is the indicator, `STRIP` the effort names and selected row, and `GRID` every row. An effort change opens to `STRIP`, and other model rows open for a model key.
- The bar eases and rows step, as two values. Rows wait for `BAR_READY` on the way open, and the bar waits for them on the way closed.
- The motion holds no start or end time, so a key at any moment continues from what's drawn. An effort key during a fold holds the rows still open.
- The timer stops once settled, so the band costs nothing at rest. `prefersReducedMotion` jumps to the goal.

**Use one hold timer.** Holding goes through `wait()`, so a key press starts it over. Don't call `$.clock.after` anywhere else. The grid doesn't close while a dialog is open.

**Mind how input reaches the mod:**

- A Button's chord only works while it's drawn, and anything drawn on a Button takes clicks too. So empty effort Buttons stay mounted beside the `Client`, in the hooks' tree, which keeps ctrl+1..5 alive in every form and leaves nothing to click.
- A shift-only key can't press a Button, so shift+arrows are `command:` bindings. Those draw an echo and a spinner for a frame, which the `UserMessage` and `Spinner` render hooks hide.
- Slash commands skip `prompt.submit`, and `turnRunning` relies on that to tell a real turn from a key press.

**Update these together when adding a model or effort level:**

- `MODELS` or `EFFORTS`, plus the matching type. `MODELS` stays strongest first, because shift+up moves toward stronger models.
- `VERSIONS`, for a model, and again whenever a new version ships.
- `COLORS`, for an effort level. These match the `/effort` slider, and `max` draws from `RAINBOW`.
- A model's name must fit `LABEL`, its name and version `VERSIONED_LABEL`, and effort names the `CELL` width.
- `modelOf` matches by substring of the model id, so a model name must not appear inside another model's id.

## Tests

- Hooks registered through `on` in a test stand in for the engine, and nothing runs beneath them. Answer every event the mod reaches, as the existing tests do.
- There are two clocks. Use `mock.clock(on)` and `clock.advance` for the hold, and `ui.advance` for frames. The tests repeat `HOLD`, so changing it means updating them.
- A frame's size follows the wall clock, so assert on order and direction during motion, and on exact values only in a key's first frame or once settled.
- Tests find elements by `key` (`indicator`, `bar-high`, `opus-max`, and the chord Buttons `low` to `max`), so changing a key breaks them. Pass `in: 'band'` for anything the surface draws, since the chord Buttons are the only keys in the hooks' own tree.
- Cover behaviour changes by extending the existing scenario tests. Include the decline path for anything that asks.

## Conventions

- Code style: no semicolons, single quotes, 2-space indent. There's no formatter, so match the surrounding code.
- Comments explain why something is the way it is, usually an engine behaviour the code works around. Keep them when moving code, and don't add ones that restate it.
- A `ponytail:` comment marks a deliberate shortcut and what would make it need revisiting. Add one when you take a shortcut, and remove it when you fix one.
- Prefer the smallest change, and keep the code in `register.tsx` unless a split clearly pays for itself.
- Commit subjects are imperative and in sentence case. The body says why, not what.
