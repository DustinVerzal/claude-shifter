# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who use Claude Code every day from a terminal. They care how their limit gets spent and how well Claude thinks, and they leave both on one setting because changing them interrupts the work.

## Product Purpose

effortless draws the model and effort above the Claude Code prompt, so changing either takes a keypress. Success is a changed habit: effort gets chosen per prompt, and the cheaper settings get used.

## Positioning

The change happens while a half-typed prompt stays in the input, adds nothing to the transcript, and writes nothing to `settings.json`. `/model` and `/effort` can't do that, because they print and persist by design.

## Operating Context

- Mid-prompt, in a terminal. It rests as two words, `opus high`, opens on a keypress, and folds itself away.
- `shift+arrows` move the dot and `ctrl+1..5` jump to an effort column, through bindings each person adds to `~/.claude/keybindings.json`. Keyboard only, so those bindings are a required install step.
- Prompt caches are per model, so switching models mid-session makes the next request cost more. The mod asks first. Effort changes never ask.

## Capabilities and Constraints

- Models: fable, opus, sonnet, haiku. Efforts: low, medium, high, xhigh, max.
- Effort is set through the session's `CLAUDE_CODE_EFFORT_LEVEL`. Model is set by rewriting main requests only, so subagents stay on the session's model and the engine's own model name doesn't change.
- A typed `/effort`, `/model` or the picker wins over the grid.
- No dependencies, drawn with Claude Code's own components and theme keys, using the `/effort` slider's colors.
- Tested on Claude Code 2.1.318. Minimum version undecided.

## Brand Commitments

- The name is lowercase `effortless`.
- Repo `DustinVerzal/effortless`, MIT licensed.
- Sibling of `DustinVerzal/magic-router`.
- The aesthetic is premium and native to Claude Code, confirmed by the author.
- The "why" is told in the author's first person.

## Evidence on Hand

- The author's own experience: effort per prompt instead of one high setting, and Haiku and low effort actually getting used.
- Real terminal captures of the running mod.
- No benchmarks, cost measurements, user counts, or testimonials exist. Don't state any.

## Product Principles

- Changing the setting costs less than deciding to change it.
- Nothing lands in the transcript or settings as a side effect.
- Warn before spending someone's cache, and never otherwise interrupt.
- Choices made outside the grid win.
