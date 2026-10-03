// His marks on the engine's own rows, never in place of them, so the desktop transcript reads like
// a play script: his name above each of Claude's replies and yours above each of your prompts, a
// stage direction above the question card while he waits for your answer, one line under
// /compact's row when the offering box is swept out, and his spark beside each tool row (the
// one he draws next to a well-written comment). The footer names a mode while his voice speaks
// throughout.
//
// Every engine row is drawn whole by the engine, inside a box of ours: nothing the transcript
// stores or the model reads changes, no row loses its controls, and error, permission and
// security rows are never touched (an errored /compact row gets no line). One setting governs
// it all: `on`, `replies` (his marks without yours) or `off` (`/claudesama marks ...`, or his
// Settings page). It is read from the store once per load, every drawing that starts before the
// read lands waits on that same read, and after it each row reads a module value: per row, one
// function call and a comparison, no state read, no picture.
//
// The desktop step row would take his reading word in place of a bare "Working", but the desktop
// app (2.1.286) does not raise it: the hook below is dormant there, and nothing promises it.

import type { EngineInterface, On, RenderElement } from 'claude-code'
import { NO_ITALIC } from './book'
import { MARKS_DEFAULT, latest, marksFrom } from './latest'
import type { Marks } from './latest'
import { PERSON } from './mood'
import { gapBefore } from './typeset'
import { WORDS } from './words'
import type { Lang } from './words'

type Engine = EngineInterface

function wordsOf(lang: string): (typeof WORDS)['en'] {
  return WORDS[lang as Lang] ?? WORDS.en
}


// His spark beside a tool row: his crest as a tiny picture, built once. Decorative, so its alt is
// empty and screen readers skip it. The colour is fixed, a little deeper than the brand coral so
// it keeps 3:1 against both desktop themes: 3.65:1 on the light page (#FAF9F5), 4.33:1 on the
// dark (#1F1E1D), 3.31:1 and 3.73:1 on the band's light and dark frames.
const SPARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 20" width="12" height="20">' +
  '<path d="M6 5.5v9M1.5 10h9M2.82 6.82l6.36 6.36M9.18 6.82l-6.36 6.36" stroke="#CC6440" stroke-width="1.5" stroke-linecap="round"/>' +
  '</svg>'

// Placed in the row's left gutter, two cells out, so the engine's row does not move: it leaves
// the flow and takes no room. Built once from the first row's element table and reused.
let spark: RenderElement | undefined

// The setting as stored, read once; a choice made meanwhile (setMarks in pages.tsx) wins.
function marksOf($: Engine): Marks | Promise<Marks> {
  if (latest.marks !== undefined) return latest.marks
  latest.marksRead ??= $.store.get('marks').then(
    stored => (latest.marks ??= marksFrom(stored)),
    () => (latest.marks ??= MARKS_DEFAULT),
  )
  return latest.marksRead
}

export function registerTranscript(on: On): void {
  // His name above the first block of each reply. Desktop only: the terminal already opens each
  // reply with its own mark. The name is plain text at the theme's full contrast; only the crest
  // takes his colour.
  on('ui.render', { component: 'AssistantMessage', surface: 'desktop' }, async ($, e, next) => {
    if (!e.props.isFirstOfReply || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>
          <Text color="claude">{'✻ '}</Text>
          {wordsOf(latest.view?.lang ?? 'en').name}
        </Text>
        {theirs}
      </Box>
    )
  })

  // Yours above each prompt you wrote (typed, from a phone, or in the app); a task's notification
  // or another session's message keeps only the engine's own marking. Only with marks `on`. The
  // desktop draws your bubble on the right, so your name stands on the right too (owner, 19:42).
  on('ui.render', { component: 'UserMessage', surface: 'desktop' }, async ($, e, next) => {
    if (!PERSON.has(e.props.origin.kind) || (latest.marks ?? (await marksOf($))) !== 'on') return next(e)
    const theirs = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="flex-end">
          <Text bold>{wordsOf(latest.view?.lang ?? 'en').marks.you}</Text>
        </Box>
        {theirs}
      </Box>
    )
  })

  // Above the question card: his name and the band's own stage direction for a question, so
  // "your turn" reads at a glance. The card is the engine's, untouched.
  on('ui.render', { component: 'AskUserQuestion', surface: 'desktop' }, async ($, e, next) => {
    if ((latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const lang = latest.view?.lang ?? 'en'
    const w = wordsOf(lang)
    return (
      <Box flexDirection="column">
        <Text wrap="wrap">
          <Text bold>
            <Text color="claude">{'✻ '}</Text>
            {w.name}
          </Text>
          {gapBefore(w.aside.question)}
          <Text italic={!NO_ITALIC.has(lang)}>{w.aside.question}</Text>
        </Text>
        {theirs}
      </Box>
    )
  })

  // Under /compact's row: the offering box swept out. Only for a compaction that went through.
  on('ui.render', { component: 'CommandOutput', surface: 'desktop' }, async ($, e, next) => {
    if (e.props.command !== 'compact' || e.props.isErrored || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const lang = latest.view?.lang ?? 'en'
    const w = wordsOf(lang)
    return (
      <Box flexDirection="column">
        {theirs}
        <Text wrap="wrap">
          <Text bold>
            <Text color="claude">{'✻ '}</Text>
            {w.name}
          </Text>
          {gapBefore(w.marks.swept)}
          <Text italic={!NO_ITALIC.has(lang)}>{w.marks.swept}</Text>
        </Text>
      </Box>
    )
  })

  // His spark beside each tool row and each folded group of them; the row is the engine's, whole
  // and where it was. Shown with his marks (`on` or `replies`), gone with `off`.
  on('ui.render', { component: 'ToolUse', surface: 'desktop' }, async ($, e, next) => {
    if ((latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Svg } = $.ui.resolve(e)
    spark ??= (
      <Box position="absolute" left={-2} top={0}>
        <Svg alt="" source={SPARK} width={12} height={20} />
      </Box>
    )
    return (
      <Box flexDirection="column">
        {theirs}
        {spark}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolGroup', surface: 'desktop' }, async ($, e, next) => {
    if ((latest.marks ?? (await marksOf($))) === 'off') return next(e)
    const theirs = await next(e)
    const { Box, Svg } = $.ui.resolve(e)
    spark ??= (
      <Box position="absolute" left={-2} top={0}>
        <Svg alt="" source={SPARK} width={12} height={20} />
      </Box>
    )
    return (
      <Box flexDirection="column">
        {theirs}
        {spark}
      </Box>
    )
  })

  // Dormant on today's desktop (see above): where the step row has nothing to say but "Working",
  // his reading word. A step's own words and every message the engine puts there pass untouched.
  on('ui.render', { component: 'Spinner', surface: 'desktop' }, async ($, e, next) => {
    const verb = latest.view?.verb
    if (e.props.message !== null || e.props.word !== 'Working' || !verb || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    return next({ ...e, props: { ...e.props, word: verb } })
  })

  // A mode label in the desktop footer while his voice is full, so nobody wonders why Claude
  // sounds different. Light, the default, adds at most one line after a task and shows nothing.
  on('ui.render', { component: 'SessionMode', surface: 'desktop' }, async ($, e, next) => {
    const view = latest.view
    if (view?.voice !== 'full' || (latest.marks ?? (await marksOf($))) === 'off') return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, wordsOf(view.lang).marks.mode] } })
  })
}
