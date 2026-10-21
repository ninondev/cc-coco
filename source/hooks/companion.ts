import { MOTION } from './d1-state.js'
import { c3Word } from './c3-words'
import { d1Word } from './d1-state.js'
// The companion feed: what Coco is doing now, for the companion app that stands beside the
// Claude desktop app's window (plugin/companion, macOS only, installed by /coco:companion).
//
// register.tsx's push() atomically replaces the feed, and only when two things hold:
// the record changed (blinks and loop frames do not change it: the companion runs the loop
// itself), and the companion's folder exists. `install` creates that folder and `uninstall`
// moves it to the Trash, so nobody without the companion ever gets a file.
//
// Where: ~/Library/Application Support/Coco/view.json (the Windows and Linux pet's folder is
// %APPDATA%\Coco or ~/.config/coco-pet). His settings and this feed
// share this folder; the app lives in ~/Applications. The mod can write the feed with $.fs.write (any
// path the user can write) and the companion, a user-level process, can read it. HOME is used
// rather than Claude Code's config directory, so a session with CLAUDE_CONFIG_DIR set still
// reaches the same companion.
//
// The feed is replaced atomically; defensive readers retain their last valid snapshot on a bad
// file and read again on the next change. Several sessions share the file; each write carries its
// session id, its time and whether the session draws on the desktop app. The companion keeps the
// newest record per session and shows, among desktop sessions when there are any, the newest one
// that is doing something; idle and sleeping sessions never take him from a busy one.

import { LOOPS, STILL, linesFor } from './mood'
import type { EngineInterface } from 'claude-code'
import { WORDS } from './words'
import { quotaBandItems } from './quota'
import type { Lang } from './words'
import { basename, middleCut } from './tasks'
import { lineParts } from './line-slot'
import { displaySlots } from './display-slots'
import type { LineValue } from './line-slot'
import type { TaskDescription } from './tasks'
import type { CocoView as View, CompanionActivity } from '../types'

/** The companion's folder on macOS, under HOME. It exists only while the companion is installed. The Windows and
 *  Linux pet keeps its own in each system's usual place (pet-program.ts petDataFolder). */
export const COMPANION_DIR = 'Library/Application Support/Coco'
/** The feed file, under HOME. */
export const COMPANION_FEED = `${COMPANION_DIR}/view.json`

// Keep a summon in later mood records too: a busy session must not erase the button's press
// before the companion reads it. This is a time stamp, not a new line or a change of mood.
let lastSummon: number | undefined

export type CompanionRequest = {
  summon?: number
  follow?: number
  settings?: number
  longTaskAuthorizationRequest?: number
  longTaskSettingsRequest?: number
  size?: { to: 'tiny' | 'small' | 'medium' | 'large' | 'larger'; at: number }
  login?: { on: boolean; at: number }
  capture?: { on: boolean; at: number }
}
// Like summons, requests survive later mood writes until the app has read the feed.
let lastRequests: Omit<CompanionRequest, 'summon'> = {}

export function clearCompanionLongTaskAuthorization(): void {
  delete lastRequests.longTaskAuthorizationRequest
}

// The session's folder rides along for the Windows and Linux pet: its New chat starts the terminal version there
// (companion-rs/src/new_chat.rs).
let activity: CompanionActivity & { cwd?: string } = emptyActivity()
let task: TaskDescription | null = null

function emptyActivity(): CompanionActivity {
  return { project: '', done: null, waitAt: null, reply: null, notice: null, ack: null, channel: false }
}

/** A fresh session owns its own Activity and book requests. */
export function companionSession(root: string): void {
  activity = { ...emptyActivity(), project: middleCut(basename(root), 24), ...(root ? { cwd: root } : {}) }
  task = null
  lastSummon = undefined
  lastRequests = {}
}

export function companionActivity(patch: Partial<CompanionActivity>): void {
  Object.assign(activity, patch)
}

export function companionTask(description: TaskDescription | null): void {
  task = description
}

// The DM thread for the pet's DM window (dm.ts; owner's card 10-17 late: one thread, read or reply on either): there
// while Talk is on, with its newest messages as Talk keeps them for the next session (plain, secrets hidden), and lane
// B's words for the window (more.talk.label, more.talk.placeholder).
export type CompanionDmLine = { side: 'person' | 'him'; text: string }
export type CompanionDmWords = { label: string; placeholder: string }
export const COMPANION_DM_LINES = 20
export const COMPANION_DM_CHARS = 1000
let dmOn = false
let dmThread: CompanionDmLine[] = []
let dmWords: CompanionDmWords = { label: '', placeholder: '' }
let dmNotify = true
export function companionDm(on: boolean, thread?: readonly CompanionDmLine[], words?: CompanionDmWords, notify?: boolean): void {
  dmOn = on
  if (!on) dmThread = []
  else if (thread) dmThread = thread.slice(-COMPANION_DM_LINES).map(line => ({ side: line.side, text: [...line.text].slice(0, COMPANION_DM_CHARS).join('') }))
  if (words) dmWords = { label: words.label.slice(0, 64), placeholder: words.placeholder.slice(0, 128) }
  if (notify !== undefined) dmNotify = notify
}

// The Mac pet's own Dock tile (S21 on the switches page): off unless the person turns it on.
let dockTile = false
export function companionDock(on: boolean): void {
  dockTile = on
}

export function companionSeen(upto: number): void {
  if (activity.reply && activity.reply.at <= upto) activity.reply = null
  if (activity.notice && activity.notice.at <= upto) activity.notice = null
}

type Frame = View['frame']
export type CompanionTarget = 'auto' | 'claude' | 'vscode'
export type CompanionSurface = 'desktop' | 'vscode' | 'terminal' | 'remote'

/** Event callers refresh this before feed dedupe; no polling or stored client cache. */
export async function companionFeedContext($: Pick<EngineInterface, 'session'>, key: string): Promise<string> {
  const surfaces = await $.session.surfaces()
  return JSON.stringify({ ...JSON.parse(key), surfaces, desktop: surfaces.includes('desktop') })
}
export type CompanionWords = {
  followMenu: string; offerTitle: string; offerBody: string; yes: string; later: string; waitTitle: string; waitBody: string; open: string; close: string; thanks: string
  pat: string; hide: string; home: string; quit: string; patMenu: string; actions: string; actWave: string; actHug: string; actFlustered: string; login: string; hideMenu: string; hideHour: string; hideUntil: string; size: string; tiny: string; small: string; medium: string; large: string; larger: string; context: string
  activity: string; activityMenu: string; empty: string; ready: string; finished: string; placeholder: string; send: string; sending: string; unconfirmed: string; retry: string; expired: string; dictate: string; newChat: string; newChatTerminal: string; newChatDesktop: string; newChatVSCode: string; confirmClear: string; clear: string; cancel: string; badge: string; opens: string; back: string; hideLines: string; showLines: string
}

// Nothing going on: such a session never takes the companion from one that is working or waiting.
const RESTING: ReadonlySet<View['mood']> = new Set(['idle', 'sleep'])

// The companion's own few words, sent with each record in the session's language: the VoiceOver
// hint on his sprite and his right-click menu (size, hide, put back, quit). A language without
// its own set gets English.
// What they do when you touch them on the companion, and what they say then. Each key is a reaction:
//   pat        one click: a head pat (smug, then they duck into the hood)
//   flustered  several quick clicks
//   drag       you pick them up
//   drop       you put them down (they zip the hoodie back up)
//   hold       a long press (squished, the laptop too)
// The lines are the coordinator's pick from a brainstorm the owner asked for: cute, light, playful.
// Style for these lines only (the owner, 2026-10-02 21:38; the band's own lines keep their style):
//   - no full stop at the end in any language (no "." "。" "．"); each line ends with one compact
//     ending: a short kaomoji such as >_< T_T @_@ o.o u_u ^_^ (//ω//) (*´ω`*) (˘ᵕ˘), a single
//     emoji such as 🌸 🐍 ✨ 📖 💤, or the laugh ww
//   - a kaomoji stands alone after \n, at most 12 Unicode characters; no space before the break
//     and no trailing space on the text line; emoji and ww stay on the text line
//   - within a key every line ends differently, so repeated pats never end the same way twice in
//     a row (the companion also never follows a line with one that ends the same, brackets aside)
//   - short, all ages, never guilt or leverage; English lowercase (a kaomoji keeps its own
//     letters, as in T_T); a space before an inline emoji or ww in English, none in Chinese and Japanese
//   - kaomoji in half-width or Latin forms (･ not ・, // not 〃, > < not ＞ ＜): full-width ones
//     fall back to a CJK font and spread the face apart in his label; check new ones render
//     without tofu boxes in the system serif at 13 pt
//   - Chinese and Japanese band speech, reactions, menus and card lines use ASCII
//     commas, question/exclamation marks, colons, semicolons, parentheses and straight quotes;
//     every ellipsis is three ASCII dots, with no padding inside CJK text
//   - Japanese keeps only 、 。 「 」 full-width; Chinese keeps sentence-internal 。, 《 》
//     and the owner's chosen ～; category brackets and stage-direction asterisks use ASCII
//   - Latin words and numbers touch adjacent Han, hiragana and katakana; preserve kaomoji
//     line breaks and readable commands and paths
//   - in Chinese he is never called a god (the words tools/tests/language.test.tsx forbids); 小神 is fine
// An Option-click had its own reaction (Shiori peeking out); his 10-16 card left it until after 1.0, with the easter eggs.
export type ReactionKey = 'pat' | 'flustered' | 'drag' | 'drop' | 'hold' | 'ride' | 'shaken'
const COMPANION_REACTIONS_CACHE: Partial<Partial<Record<View['lang'], Record<ReactionKey, readonly string[]>>>> = {}
const COMPANION_REACTIONS: Partial<Record<View['lang'], Record<ReactionKey, readonly string[]>>> = {
  get "en"() { return COMPANION_REACTIONS_CACHE["en"] ??= {
    ride: ["whoa, so fast 💨", "where is this window going\n@_@", "holding on, holding on\n>_<", "my keycap clip nearly flew off ⌨️", "(dizzy) ...once more ✨", "the hood caught the wind\no.o"],
    pat: ["more pats. that's an order ✨", "antennae up\n(*´ω`*)", "the keycap clip's crooked now\n>_<", "(hides in the hood)\n˘ᵕ˘", "purrr 🐱"],
    flustered: ["too fast\n>_<", "stop poking\n(//ω//)", "i'm not a button\n(>д<)", "combo broken 💦", "my antennae are tangled\n@_@", "spam detected 🚫"],
    drag: ["we're flying ✈️", "where to\no.o", "mind the hoodie\n(⊙_⊙)", "liftoff ✨", "don't drop me\n>~<"],
    drop: ["safe landing 🛬", "(zips the hoodie back up)\nu_u", "that was fun\n^_^", "nice spot 🌿", "plop ☁️"],
    hold: ["squish\n>_<", "i'm tiny, you know\n(´･ω･`)", "let me go\n(T_T)", "the laptop's getting squished 💻"],
    shaken: ["so dizzy\n@_@", "the room won't stop 💫", "my laptop\n>_<", "not again\n(>д<)"],
  } },
  get "zh"() { return COMPANION_REACTIONS_CACHE["zh"] ??= {
    ride: ["好快好快💨", "这窗口赶着去哪呀\n@_@", "抓住了抓住了\n>_<", "键帽发夹差点飞了⌨️", "(晕乎乎)再来一次也行✨"],
    pat: ["再摸一下,这是命令✨", "呆毛竖起来了\n(*´ω`*)", "键帽发夹被摸歪了\n>_<", "(缩到帽子里)\n˘ᵕ˘", "咕噜噜～🐱"],
    flustered: ["太快了\n>_<", "别一直戳\n(//ω//)", "我不是按钮\n(>д<)", "连击断了💦", "呆毛打结了\n@_@", "刷屏警告🚫"],
    drag: ["飞起来了✈️", "去哪呀\no.o", "卫衣别拽皱了\n(⊙_⊙)", "升空✨", "别摔着我\n>~<"],
    drop: ["安全着地🛬", "(把卫衣拉链拉好)\nu_u", "还挺好玩的\n^_^", "这儿不错🌿", "吧唧☁️"],
    hold: ["被捏住了\n>_<", "我很小的\n(´･ω･`)", "放开我呀\n(T_T)"],
    shaken: ["呜呜..."],
  } },
  // BEGIN generated zh-Hant /COMPANION_REACTIONS/zh; OpenCC 0.1.7; s2twp
  get "zh-Hant"() { return COMPANION_REACTIONS_CACHE["zh-Hant"] ??= {
    ride: ["好快好快💨", "這視窗趕著去哪呀\n@_@", "抓住了抓住了\n>_<", "鍵帽髮夾差點飛了⌨️", "(暈乎乎)再來一次也行✨"],
    pat: ["再摸一下,這是命令✨", "呆毛豎起來了\n(*´ω`*)", "鍵帽髮夾被摸歪了\n>_<", "(縮到帽子裡)\n˘ᵕ˘", "咕嚕嚕～🐱"],
    flustered: ["太快了\n>_<", "別一直戳\n(//ω//)", "我不是按鈕\n(>д<)", "連擊斷了💦", "呆毛打結了\n@_@", "刷屏警告🚫"],
    drag: ["飛起來了✈️", "去哪呀\no.o", "衛衣別拽皺了\n(⊙_⊙)", "升空✨", "別摔著我\n>~<"],
    drop: ["安全著地🛬", "(把衛衣拉鍊拉好)\nu_u", "還挺好玩的\n^_^", "這兒不錯🌿", "吧唧☁️"],
    hold: ["被捏住了\n>_<", "我很小的\n(´･ω･`)", "放開我呀\n(T_T)"],
    shaken: ["嗚嗚..."],
  } },
  // END generated zh-Hant

  get "ja"() { return COMPANION_REACTIONS_CACHE["ja"] ??= {
    ride: ["はやいはやい💨", "このウィンドウどこ行くの\n@_@", "つかまってる、つかまってる\n>_<", "キーキャップのピンが飛びそう⌨️", "(ふらふら)もう一回でもいいよ✨", "フードに風が入った\no.o"],
    pat: ["もっとなでて。命令だよ✨", "アホ毛が立っちゃった\n(*´ω`*)", "ピンがずれた\n>_<", "(フードにもぐる)\n˘ᵕ˘", "ごろごろ🐱"],
    flustered: ["はやすぎ\n>_<", "つつきすぎ\n(//ω//)", "ボタンじゃないよ\n(>д<)", "コンボ切れた💦", "アホ毛がからまった\n@_@", "連打禁止🚫"],
    drag: ["飛んでる✈️", "どこ行くの\no.o", "パーカー引っぱらないで\n(⊙_⊙)", "離陸✨", "落とさないでね\n>~<"],
    drop: ["着地成功🛬", "(パーカーのジッパーを上げる)\nu_u", "ちょっと楽しかった\n^_^", "ここいいね🌿", "ぽすっ☁️"],
    hold: ["むぎゅ\n>_<", "ちっちゃいんだから\n(´･ω･`)", "はなしてよ\n(T_T)", "ノートPCがつぶれちゃう💻"],
    shaken: ["目が回る\n@_@", "部屋がまだ回ってる💫", "ノートPCが\n>_<", "またぁ\n(>д<)"],
  } },
  get "fr"() { return COMPANION_REACTIONS_CACHE["fr"] ??= {
    ride: ["waouh, ça file 💨", "elle va où, cette fenêtre\n@_@", "je m'accroche, je m'accroche\n>_<", "ma barrette a failli s'envoler ⌨️", "(tête qui tourne) encore une fois ✨", "ma capuche a pris le vent\no.o"],
    pat: ["encore des caresses, c'est un ordre ✨", "mes antennes se dressent\n(*´ω`*)", "(se cache dans la capuche)\n˘ᵕ˘", "ronron 🐱"],
    flustered: ["arrête de me piquer\n(//ω//)", "je suis pas un bouton\n(>д<)", "combo cassé 💦", "spam détecté 🚫"],
    drag: ["on s'envole ✈️", "on va où\no.o", "attention au sweat\n(⊙_⊙)", "me lâche pas\n>~<"],
    drop: ["atterrissage réussi 🛬", "(remonte la fermeture du sweat)\nu_u", "c'était marrant\n^_^", "pas mal, ici 🌿"],
    hold: ["écrabouillée\n>_<", "je suis toute petite, hein\n(´･ω･`)", "lâche-moi\n(T_T)", "le laptop va s'aplatir 💻"],
    shaken: ["la tête me tourne\n@_@", "la pièce tourne encore 💫", "mon laptop\n>_<", "oh non, encore\n(>д<)"],
  } },
  get "de"() { return COMPANION_REACTIONS_CACHE["de"] ??= {
    ride: ["Wow, ist das schnell 💨", "Wo fährt dieses Fenster hin\n@_@", "Festhalten, festhalten\n>_<", "Fast flog die Keycap-Spange weg ⌨️", "(schwindelig) Gern noch mal ✨", "Die Kapuze fängt Wind\no.o"],
    pat: ["Mehr streicheln, das ist ein Befehl ✨", "Die Antennen stehen\n(*´ω`*)", "(versteckt sich in der Kapuze)\n˘ᵕ˘", "Schnurr 🐱"],
    flustered: ["Hör auf zu stupsen\n(//ω//)", "Ich bin kein Knopf\n(>д<)", "Combo gerissen 💦", "Spam erkannt 🚫"],
    drag: ["Wir fliegen ✈️", "Wohin\no.o", "Vorsicht, der Hoodie\n(⊙_⊙)", "Lass mich nicht fallen\n>~<"],
    drop: ["Sicher gelandet 🛬", "(zieht den Reißverschluss hoch)\nu_u", "Das war lustig\n^_^", "Hier ist es gut 🌿"],
    hold: ["Quetsch\n>_<", "Ich bin doch winzig\n(´･ω･`)", "Lass los\n(T_T)", "Der Laptop wird platt 💻"],
    shaken: ["Mir ist schwindelig\n@_@", "Der Raum dreht sich weiter 💫", "Mein Laptop\n>_<", "Nicht schon wieder\n(>д<)"],
  } },
  get "hi"() { return COMPANION_REACTIONS_CACHE["hi"] ??= {
    ride: ["वाह, कितना तेज़ 💨", "ये विंडो कहाँ जा रही है\n@_@", "कसकर पकड़ा है\n>_<", "keycap क्लिप उड़ने वाली थी ⌨️", "(चक्कर) एक बार और ✨", "हुड में हवा भर गई\no.o"],
    pat: ["और सहलाओ, ये हुक्म है ✨", "एंटीना खड़े हो गए\n(*´ω`*)", "(हुड में छिप गई)\n˘ᵕ˘", "गुड़गुड़～🐱"],
    flustered: ["बार-बार मत छेड़ो\n(//ω//)", "मैं बटन नहीं हूँ\n(>д<)", "combo टूट गया 💦", "spam पकड़ा गया 🚫"],
    drag: ["उड़ चले ✈️", "कहाँ चलें\no.o", "हुडी संभाल के\n(⊙_⊙)", "गिराना मत\n>~<"],
    drop: ["सही-सलामत उतरी 🛬", "(हुडी की ज़िप ऊपर)\nu_u", "मज़ा आया\n^_^", "अच्छी जगह है 🌿"],
    hold: ["दब गई\n>_<", "मैं छोटी सी हूँ\n(´･ω･`)", "छोड़ो ना\n(T_T)", "laptop पिचक जाएगा 💻"],
    shaken: ["सिर घूम रहा है\n@_@", "कमरा अब भी घूम रहा है 💫", "मेरा laptop\n>_<", "फिर से नहीं\n(>д<)"],
  } },
  get "id"() { return COMPANION_REACTIONS_CACHE["id"] ??= {
    ride: ["wah, cepat banget 💨", "jendela ini mau ke mana\n@_@", "pegangan, pegangan\n>_<", "jepit keycap-ku hampir terbang ⌨️", "(pusing) sekali lagi ✨", "tudungku kemasukan angin\no.o"],
    pat: ["elus lagi, ini perintah ✨", "antenaku berdiri\n(*´ω`*)", "(ngumpet di tudung)\n˘ᵕ˘", "purrr～🐱"],
    flustered: ["jangan colek terus\n(//ω//)", "aku bukan tombol\n(>д<)", "combo putus 💦", "spam terdeteksi 🚫"],
    drag: ["terbang ✈️", "mau ke mana\no.o", "hati-hati hoodie-ku\n(⊙_⊙)", "jangan dijatuhin\n>~<"],
    drop: ["mendarat mulus 🛬", "(naikin resleting hoodie)\nu_u", "seru juga\n^_^", "di sini enak 🌿"],
    hold: ["kepencet\n>_<", "aku kecil, lho\n(´･ω･`)", "lepasin\n(T_T)", "laptopnya gepeng nanti 💻"],
    shaken: ["pusing\n@_@", "kamarnya masih muter 💫", "laptopku\n>_<", "jangan lagi\n(>д<)"],
  } },
  get "it"() { return COMPANION_REACTIONS_CACHE["it"] ??= {
    ride: ["wow, che velocità 💨", "dove va questa finestra\n@_@", "mi tengo forte\n>_<", "il fermaglio stava per volare via ⌨️", "(stordita) ancora una volta ✨", "il cappuccio si gonfia di vento\no.o"],
    pat: ["altre coccole, è un ordine ✨", "le antenne si drizzano\n(*´ω`*)", "(si nasconde nel cappuccio)\n˘ᵕ˘", "prrr 🐱"],
    flustered: ["smettila di punzecchiarmi\n(//ω//)", "non sono un pulsante\n(>д<)", "combo spezzata 💦", "spam rilevato 🚫"],
    drag: ["si vola ✈️", "dove andiamo\no.o", "occhio alla felpa\n(⊙_⊙)", "non farmi cadere\n>~<"],
    drop: ["atterraggio perfetto 🛬", "(tira su la zip della felpa)\nu_u", "che divertente\n^_^", "qui si sta bene 🌿"],
    hold: ["schiacciata\n>_<", "sono piccolina, eh\n(´･ω･`)", "lasciami\n(T_T)", "il portatile si schiaccia 💻"],
    shaken: ["mi gira la testa\n@_@", "la stanza gira ancora 💫", "il mio portatile\n>_<", "di nuovo no\n(>д<)"],
  } },
  get "ko"() { return COMPANION_REACTIONS_CACHE["ko"] ??= {
    ride: ["와, 빠르다 💨", "이 창 어디 가는 거야\n@_@", "꽉 잡았어, 꽉\n>_<", "키캡 핀 날아갈 뻔했어 ⌨️", "(어질어질) 한 번 더 해도 돼 ✨", "후드에 바람 들어갔어\no.o"],
    pat: ["더 쓰다듬어. 명령이야 ✨", "바보털 섰잖아\n(*´ω`*)", "(후드 속으로 쏙)\n˘ᵕ˘", "그르르～🐱"],
    flustered: ["그만 찔러\n(//ω//)", "나 버튼 아니거든\n(>д<)", "콤보 끊겼어 💦", "연타 금지 🚫"],
    drag: ["날아간다 ✈️", "어디 가\no.o", "후드티 늘어나\n(⊙_⊙)", "떨어뜨리지 마\n>~<"],
    drop: ["착지 성공 🛬", "(후드티 지퍼 올림)\nu_u", "재밌었어\n^_^", "여기 괜찮은데 🌿"],
    hold: ["꾹\n>_<", "나 작거든\n(´･ω･`)", "놔줘\n(T_T)", "노트북 찌그러져 💻"],
    shaken: ["어지러워\n@_@", "방이 계속 돌아 💫", "내 노트북\n>_<", "또야\n(>д<)"],
  } },
  get "pt-BR"() { return COMPANION_REACTIONS_CACHE["pt-BR"] ??= {
    ride: ["uau, que rápido 💨", "pra onde vai essa janela\n@_@", "segurando firme\n>_<", "minha presilha quase voou ⌨️", "(tonta) mais uma vez ✨", "o capuz encheu de vento\no.o"],
    pat: ["mais carinho, é uma ordem ✨", "as anteninhas subiram\n(*´ω`*)", "(se esconde no capuz)\n˘ᵕ˘", "mrrrr 🐱"],
    flustered: ["para de cutucar\n(//ω//)", "eu não sou botão\n(>д<)", "combo quebrado 💦", "spam detectado 🚫"],
    drag: ["tô voando ✈️", "pra onde\no.o", "cuidado com o moletom\n(⊙_⊙)", "não me deixa cair\n>~<"],
    drop: ["pouso perfeito 🛬", "(fecha o zíper do moletom)\nu_u", "foi divertido\n^_^", "aqui tá bom 🌿"],
    hold: ["esmagada\n>_<", "eu sou pequenininha\n(´･ω･`)", "me solta\n(T_T)", "o notebook vai amassar 💻"],
    shaken: ["que tontura\n@_@", "o quarto não para de girar 💫", "meu notebook\n>_<", "de novo não\n(>д<)"],
  } },
  get "es-419"() { return COMPANION_REACTIONS_CACHE["es-419"] ??= {
    ride: ["guau, qué rápido 💨", "¿a dónde va esta ventana?\n@_@", "me agarro fuerte\n>_<", "casi sale volando mi pasador ⌨️", "(mareada) otra vez ✨", "la capucha se llena de aire\no.o"],
    pat: ["más mimos, es una orden ✨", "se me paran las antenas\n(*´ω`*)", "(se esconde en la capucha)\n˘ᵕ˘", "mmrrr 🐱"],
    flustered: ["ya no me piques\n(//ω//)", "no soy un botón\n(>д<)", "se rompió el combo 💦", "spam detectado 🚫"],
    drag: ["¡volamos! ✈️", "¿a dónde?\no.o", "cuidado con la sudadera\n(⊙_⊙)", "no me sueltes\n>~<"],
    drop: ["aterrizaje perfecto 🛬", "(se sube el cierre)\nu_u", "estuvo divertido\n^_^", "aquí se está bien 🌿"],
    hold: ["apachurrada\n>_<", "soy chiquita, eh\n(´･ω･`)", "suéltame\n(T_T)", "se aplasta la laptop 💻"],
    shaken: ["qué mareo\n@_@", "el cuarto sigue girando 💫", "mi laptop\n>_<", "otra vez no\n(>д<)"],
  } },
  get "es-ES"() { return COMPANION_REACTIONS_CACHE["es-ES"] ??= {
    ride: ["uau, qué rápido 💨", "¿adónde va esta ventana?\n@_@", "me agarro fuerte\n>_<", "casi sale volando mi horquilla ⌨️", "(mareada) otra vez ✨", "la capucha se llena de aire\no.o"],
    pat: ["más mimos, es una orden ✨", "las antenas de punta\n(*´ω`*)", "(se esconde en la capucha)\n˘ᵕ˘", "mrrr 🐱"],
    flustered: ["deja de pincharme\n(//ω//)", "no soy un botón\n(>д<)", "combo roto 💦", "spam detectado 🚫"],
    drag: ["¡volamos! ✈️", "¿adónde?\no.o", "cuidado con la sudadera\n(⊙_⊙)", "no me sueltes\n>~<"],
    drop: ["aterrizaje perfecto 🛬", "(se sube la cremallera)\nu_u", "ha sido divertido\n^_^", "aquí se está bien 🌿"],
    hold: ["espachurrada\n>_<", "que soy chiquitita\n(´･ω･`)", "suéltame\n(T_T)", "que se aplasta el portátil 💻"],
    shaken: ["qué mareo\n@_@", "la habitación sigue girando 💫", "mi portátil\n>_<", "otra vez no\n(>д<)"],
  } },
}

const COMPANION_CARD_WORDS_CACHE: Partial<Record<View['lang'], Pick<CompanionWords, 'followMenu' | 'offerTitle' | 'offerBody' | 'yes' | 'later' | 'waitTitle' | 'waitBody' | 'open' | 'close' | 'thanks'>>> = {}
const COMPANION_CARD_WORDS: Record<View['lang'], Pick<CompanionWords, 'followMenu' | 'offerTitle' | 'offerBody' | 'yes' | 'later' | 'waitTitle' | 'waitBody' | 'open' | 'close' | 'thanks'>> = {
  get "en"() { return COMPANION_CARD_WORDS_CACHE["en"] ??= {
    "followMenu": "Let Coco follow the window…",
    "offerTitle": "May I follow your window?",
    "offerBody": "Then I can stay right beside it. I only see where it is.",
    "yes": "Yes, follow it",
    "later": "Not now",
    "waitTitle": "Switch me on in System Settings",
    "waitBody": "Privacy & Security › Accessibility",
    "open": "Open System Settings",
    "close": "Close",
    "thanks": "thanks, i'll keep up with your window ✨"
  } },
  get "zh"() { return COMPANION_CARD_WORDS_CACHE["zh"] ??= {
    "followMenu": "让他跟着窗口...",
    "offerTitle": "可以让我跟着你的窗口吗?",
    "offerBody": "这样我就能一直在旁边。我只看它在哪儿",
    "yes": "好,跟着吧",
    "later": "先不用",
    "waitTitle": "去系统设置里把我打开",
    "waitBody": "隐私与安全性 › 辅助功能",
    "open": "打开系统设置",
    "close": "关闭",
    "thanks": "谢谢,我会跟紧你的窗口✨"
  } },
  // BEGIN generated zh-Hant /COMPANION_CARD_WORDS/zh; OpenCC 0.1.7; s2twp
  get "zh-Hant"() { return COMPANION_CARD_WORDS_CACHE["zh-Hant"] ??= {
    "followMenu": "讓他跟著視窗...",
    "offerTitle": "可以讓我跟著你的視窗嗎?",
    "offerBody": "這樣我就能一直在旁邊。我只看它在哪兒",
    "yes": "好,跟著吧",
    "later": "先不用",
    "waitTitle": "去系統設定裡把我開啟",
    "waitBody": "隱私與安全性 › 輔助功能",
    "open": "開啟系統設定",
    "close": "關閉",
    "thanks": "謝謝,我會跟緊你的視窗✨"
  } },
  // END generated zh-Hant

  get "ja"() { return COMPANION_CARD_WORDS_CACHE["ja"] ??= {
    "followMenu": "ウィンドウについていかせる...",
    "offerTitle": "きみのウィンドウについていってもいい?",
    "offerBody": "そうすれば、ずっとそばにいられる。見るのは場所だけ",
    "yes": "うん、ついてきて",
    "later": "今はいい",
    "waitTitle": "システム設定でオンにしてね",
    "waitBody": "プライバシーとセキュリティ › アクセシビリティ",
    "open": "システム設定を開く",
    "close": "閉じる",
    "thanks": "ありがとう、ちゃんとついていくね✨"
  } },
  get "fr"() { return COMPANION_CARD_WORDS_CACHE["fr"] ??= {
    "followMenu": "Le laisser suivre la fenêtre…",
    "offerTitle": "Je peux suivre ta fenêtre ?",
    "offerBody": "Comme ça, je peux rester tout près. Je ne vois que sa position.",
    "yes": "Oui, suis-la",
    "later": "Pas maintenant",
    "waitTitle": "Active-moi dans Réglages Système",
    "waitBody": "Confidentialité et sécurité › Accessibilité",
    "open": "Ouvrir Réglages Système",
    "close": "Fermer",
    "thanks": "merci, je suivrai ta fenêtre ✨"
  } },
  get "de"() { return COMPANION_CARD_WORDS_CACHE["de"] ??= {
    "followMenu": "Ihm erlauben, dem Fenster zu folgen…",
    "offerTitle": "Darf ich deinem Fenster folgen?",
    "offerBody": "Dann kann ich direkt daneben bleiben. Ich sehe nur, wo es ist.",
    "yes": "Ja, folge ihm",
    "later": "Jetzt nicht",
    "waitTitle": "Schalte mich in den Systemeinstellungen ein",
    "waitBody": "Datenschutz & Sicherheit › Bedienungshilfen",
    "open": "Systemeinstellungen öffnen",
    "close": "Schließen",
    "thanks": "danke, ich bleibe bei deinem Fenster ✨"
  } },
  get "hi"() { return COMPANION_CARD_WORDS_CACHE["hi"] ??= {
    "followMenu": "उसे विंडो के साथ चलने दो…",
    "offerTitle": "क्या मैं तुम्हारी विंडो के साथ चलूँ?",
    "offerBody": "फिर मैं पास ही रह सकूँगा। मैं बस उसकी जगह देखता हूँ।",
    "yes": "हाँ, साथ चलो",
    "later": "अभी नहीं",
    "waitTitle": "सिस्टम सेटिंग में मुझे चालू करो",
    "waitBody": "गोपनीयता और सुरक्षा › ऐक्सेसिबिलिटी",
    "open": "सिस्टम सेटिंग खोलो",
    "close": "बंद करो",
    "thanks": "शुक्रिया, मैं तुम्हारी विंडो के साथ चलूँगा ✨"
  } },
  get "id"() { return COMPANION_CARD_WORDS_CACHE["id"] ??= {
    "followMenu": "Izinkan dia mengikuti jendela…",
    "offerTitle": "Boleh aku mengikuti jendelamu?",
    "offerBody": "Jadi aku bisa tetap di dekatnya. Aku hanya melihat letaknya.",
    "yes": "Ya, ikuti",
    "later": "Nanti saja",
    "waitTitle": "Aktifkan aku di Pengaturan Sistem",
    "waitBody": "Privasi & Keamanan › Aksesibilitas",
    "open": "Buka Pengaturan Sistem",
    "close": "Tutup",
    "thanks": "makasih, aku akan ikut jendelamu ✨"
  } },
  get "it"() { return COMPANION_CARD_WORDS_CACHE["it"] ??= {
    "followMenu": "Lascialo seguire la finestra…",
    "offerTitle": "Posso seguire la tua finestra?",
    "offerBody": "Così posso restarle accanto. Vedo solo dove si trova.",
    "yes": "Sì, seguila",
    "later": "Non ora",
    "waitTitle": "Attivami in Impostazioni di Sistema",
    "waitBody": "Privacy e sicurezza › Accessibilità",
    "open": "Apri Impostazioni di Sistema",
    "close": "Chiudi",
    "thanks": "grazie, starò al passo con la tua finestra ✨"
  } },
  get "ko"() { return COMPANION_CARD_WORDS_CACHE["ko"] ??= {
    "followMenu": "창을 따라가게 해 주기…",
    "offerTitle": "네 창을 따라가도 될까?",
    "offerBody": "그러면 바로 옆에 있을 수 있어. 난 창의 위치만 봐.",
    "yes": "응, 따라와",
    "later": "지금은 괜찮아",
    "waitTitle": "시스템 설정에서 나를 켜 줘",
    "waitBody": "개인정보 보호 및 보안 › 손쉬운 사용",
    "open": "시스템 설정 열기",
    "close": "닫기",
    "thanks": "고마워, 네 창을 잘 따라갈게 ✨"
  } },
  get "pt-BR"() { return COMPANION_CARD_WORDS_CACHE["pt-BR"] ??= {
    "followMenu": "Deixar ele seguir a janela…",
    "offerTitle": "Posso seguir sua janela?",
    "offerBody": "Assim eu posso ficar bem pertinho. Só vejo onde ela está.",
    "yes": "Sim, pode seguir",
    "later": "Agora não",
    "waitTitle": "Me ative em Ajustes do Sistema",
    "waitBody": "Privacidade e Segurança › Acessibilidade",
    "open": "Abrir Ajustes do Sistema",
    "close": "Fechar",
    "thanks": "obrigado, vou acompanhar sua janela ✨"
  } },
  get "es-419"() { return COMPANION_CARD_WORDS_CACHE["es-419"] ??= {
    "followMenu": "Dejarlo seguir la ventana…",
    "offerTitle": "¿Puedo seguir tu ventana?",
    "offerBody": "Así puedo quedarme a su lado. Solo veo dónde está.",
    "yes": "Sí, síguela",
    "later": "Ahora no",
    "waitTitle": "Actívame en Configuración del Sistema",
    "waitBody": "Privacidad y seguridad › Accesibilidad",
    "open": "Abrir Configuración",
    "close": "Cerrar",
    "thanks": "gracias, seguiré tu ventana ✨"
  } },
  get "es-ES"() { return COMPANION_CARD_WORDS_CACHE["es-ES"] ??= {
    "followMenu": "Dejarle seguir la ventana…",
    "offerTitle": "¿Puedo seguir tu ventana?",
    "offerBody": "Así puedo quedarme a su lado. Solo veo dónde está.",
    "yes": "Sí, síguela",
    "later": "Ahora no",
    "waitTitle": "Actívame en Ajustes del Sistema",
    "waitBody": "Privacidad y seguridad › Accesibilidad",
    "open": "Abrir Ajustes del Sistema",
    "close": "Cerrar",
    "thanks": "gracias, seguiré tu ventana ✨"
  } },
}

export type TaskKey = 'thinking' | 'reading' | 'editing' | 'running' | 'searching' | 'web' | 'helper' | 'planning' | 'using' | 'waitingOK' | 'waitingAnswer'

/** The bubble phrases: only placeholders receive a filename, program or short tool name. */
const TASK_WORDS_CACHE: Partial<Record<View['lang'], Record<TaskKey, string>>> = {}
export const TASK_WORDS: Record<View['lang'], Record<TaskKey, string>> = {
  get "en"() { return TASK_WORDS_CACHE["en"] ??= {
    "thinking": "thinking",
    "reading": "reading {file}",
    "editing": "editing {file}",
    "running": "running {cmd}",
    "searching": "searching",
    "web": "searching the web",
    "helper": "a helper is working",
    "planning": "planning",
    "using": "using {tool}",
    "waitingOK": "waiting for your OK",
    "waitingAnswer": "waiting for your answer"
  } },
  get "zh"() { return TASK_WORDS_CACHE["zh"] ??= {
    "thinking": "在想",
    "reading": "在读{file}",
    "editing": "在改{file}",
    "running": "在运行{cmd}",
    "searching": "在搜索",
    "web": "在网上查",
    "helper": "助手在干活",
    "planning": "在列计划",
    "using": "在用{tool}",
    "waitingOK": "等你同意",
    "waitingAnswer": "等你回答"
  } },
  // BEGIN generated zh-Hant /TASK_WORDS/zh; OpenCC 0.1.7; s2twp
  get "zh-Hant"() { return TASK_WORDS_CACHE["zh-Hant"] ??= {
    "thinking": "在想",
    "reading": "在讀{file}",
    "editing": "在改{file}",
    "running": "在執行{cmd}",
    "searching": "在搜尋",
    "web": "在網上查",
    "helper": "助手在幹活",
    "planning": "在列計劃",
    "using": "在用{tool}",
    "waitingOK": "等你同意",
    "waitingAnswer": "等你回答"
  } },
  // END generated zh-Hant

  get "ja"() { return TASK_WORDS_CACHE["ja"] ??= {
    "thinking": "考え中",
    "reading": "{file}を読んでいる",
    "editing": "{file}を編集中",
    "running": "{cmd}を実行中",
    "searching": "検索中",
    "web": "ウェブで調べている",
    "helper": "助手が作業中",
    "planning": "計画中",
    "using": "{tool}を使っている",
    "waitingOK": "許可待ち",
    "waitingAnswer": "返事待ち"
  } },
  get "fr"() { return TASK_WORDS_CACHE["fr"] ??= {
    "thinking": "réfléchit",
    "reading": "lit {file}",
    "editing": "modifie {file}",
    "running": "exécute {cmd}",
    "searching": "cherche",
    "web": "cherche sur le web",
    "helper": "un assistant travaille",
    "planning": "prépare un plan",
    "using": "utilise {tool}",
    "waitingOK": "attend ton accord",
    "waitingAnswer": "attend ta réponse"
  } },
  get "de"() { return TASK_WORDS_CACHE["de"] ??= {
    "thinking": "denkt nach",
    "reading": "liest {file}",
    "editing": "bearbeitet {file}",
    "running": "führt {cmd} aus",
    "searching": "sucht",
    "web": "sucht im Web",
    "helper": "ein Helfer arbeitet",
    "planning": "plant",
    "using": "nutzt {tool}",
    "waitingOK": "wartet auf dein Okay",
    "waitingAnswer": "wartet auf deine Antwort"
  } },
  get "hi"() { return TASK_WORDS_CACHE["hi"] ??= {
    "thinking": "सोच रहा है",
    "reading": "{file} पढ़ रहा है",
    "editing": "{file} बदल रहा है",
    "running": "{cmd} चला रहा है",
    "searching": "खोज रहा है",
    "web": "वेब पर खोज रहा है",
    "helper": "एक सहायक काम कर रहा है",
    "planning": "योजना बना रहा है",
    "using": "{tool} इस्तेमाल कर रहा है",
    "waitingOK": "तुम्हारी मंज़ूरी का इंतज़ार है",
    "waitingAnswer": "तुम्हारे जवाब का इंतज़ार है"
  } },
  get "id"() { return TASK_WORDS_CACHE["id"] ??= {
    "thinking": "berpikir",
    "reading": "membaca {file}",
    "editing": "mengedit {file}",
    "running": "menjalankan {cmd}",
    "searching": "mencari",
    "web": "mencari di web",
    "helper": "asisten sedang bekerja",
    "planning": "menyusun rencana",
    "using": "menggunakan {tool}",
    "waitingOK": "menunggu izinmu",
    "waitingAnswer": "menunggu jawabanmu"
  } },
  get "it"() { return TASK_WORDS_CACHE["it"] ??= {
    "thinking": "sta pensando",
    "reading": "legge {file}",
    "editing": "modifica {file}",
    "running": "esegue {cmd}",
    "searching": "sta cercando",
    "web": "cerca sul web",
    "helper": "un assistente è al lavoro",
    "planning": "prepara un piano",
    "using": "usa {tool}",
    "waitingOK": "aspetta il tuo consenso",
    "waitingAnswer": "aspetta la tua risposta"
  } },
  get "ko"() { return TASK_WORDS_CACHE["ko"] ??= {
    "thinking": "생각 중",
    "reading": "{file} 읽는 중",
    "editing": "{file} 수정 중",
    "running": "{cmd} 실행 중",
    "searching": "검색 중",
    "web": "웹 검색 중",
    "helper": "도우미가 작업 중",
    "planning": "계획 중",
    "using": "{tool} 사용 중",
    "waitingOK": "허락을 기다리는 중",
    "waitingAnswer": "답변을 기다리는 중"
  } },
  get "pt-BR"() { return TASK_WORDS_CACHE["pt-BR"] ??= {
    "thinking": "pensando",
    "reading": "lendo {file}",
    "editing": "editando {file}",
    "running": "executando {cmd}",
    "searching": "buscando",
    "web": "buscando na web",
    "helper": "um ajudante está trabalhando",
    "planning": "planejando",
    "using": "usando {tool}",
    "waitingOK": "esperando seu OK",
    "waitingAnswer": "esperando sua resposta"
  } },
  get "es-419"() { return TASK_WORDS_CACHE["es-419"] ??= {
    "thinking": "pensando",
    "reading": "leyendo {file}",
    "editing": "editando {file}",
    "running": "ejecutando {cmd}",
    "searching": "buscando",
    "web": "buscando en la web",
    "helper": "un ayudante está trabajando",
    "planning": "planeando",
    "using": "usando {tool}",
    "waitingOK": "esperando tu permiso",
    "waitingAnswer": "esperando tu respuesta"
  } },
  get "es-ES"() { return TASK_WORDS_CACHE["es-ES"] ??= {
    "thinking": "pensando",
    "reading": "leyendo {file}",
    "editing": "editando {file}",
    "running": "ejecutando {cmd}",
    "searching": "buscando",
    "web": "buscando en la web",
    "helper": "un ayudante está trabajando",
    "planning": "planificando",
    "using": "usando {tool}",
    "waitingOK": "esperando tu permiso",
    "waitingAnswer": "esperando tu respuesta"
  } },
}

const COMPANION_ACTIVITY_WORDS_CACHE: Partial<Record<View['lang'], Pick<CompanionWords, 'activity' | 'activityMenu' | 'empty' | 'ready' | 'finished' | 'placeholder' | 'send' | 'sending' | 'unconfirmed' | 'retry' | 'expired' | 'dictate' | 'newChat' | 'newChatTerminal' | 'newChatDesktop' | 'newChatVSCode' | 'confirmClear' | 'clear' | 'cancel' | 'close' | 'badge' | 'opens' | 'back' | 'hideLines' | 'showLines'>>> = {}
const COMPANION_ACTIVITY_WORDS: Record<View['lang'], Pick<CompanionWords, 'activity' | 'activityMenu' | 'empty' | 'ready' | 'finished' | 'placeholder' | 'send' | 'sending' | 'unconfirmed' | 'retry' | 'expired' | 'dictate' | 'newChat' | 'newChatTerminal' | 'newChatDesktop' | 'newChatVSCode' | 'confirmClear' | 'clear' | 'cancel' | 'close' | 'badge' | 'opens' | 'back' | 'hideLines' | 'showLines'>> = {
  get "en"() { return COMPANION_ACTIVITY_WORDS_CACHE["en"] ??= {
    "activity": "Activity",
    "activityMenu": "Activity…",
    "empty": "Nothing yet.",
    "ready": "ready",
    "finished": "finished",
    "placeholder": "Tell Claude…",
    "send": "Send",
    "sending": "Sending…",
    "unconfirmed": "Not sure it arrived",
    "retry": "Retry",
    "expired": "Timed out",
    "dictate": "Dictate",
    "newChat": "New chat",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "Clear this conversation in {project}?",
    "clear": "Clear",
    "cancel": "Cancel",
    "close": "Close",
    "badge": "{n} new. Opens Activity.",
    "opens": "Opens {app}.",
    "back": "Back to {app}",
    "hideLines": "Hide its lines",
    "showLines": "Show its lines"
  } },
  get "zh"() { return COMPANION_ACTIVITY_WORDS_CACHE["zh"] ??= {
    "activity": "活动",
    "activityMenu": "活动...",
    "empty": "还没有动静",
    "ready": "待命",
    "finished": "做完了",
    "placeholder": "跟Claude说...",
    "send": "发送",
    "sending": "正在发送...",
    "unconfirmed": "不确定送到没有",
    "retry": "重试",
    "expired": "超时了",
    "dictate": "听写",
    "newChat": "新对话",
    "newChatTerminal": "终端",
    "newChatDesktop": "Claude客户端",
    "newChatVSCode": "VS Code插件",
    "confirmClear": "清空{project}里的这段对话?",
    "clear": "清空",
    "cancel": "取消",
    "close": "关闭",
    "badge": "{n}条新动态,打开活动",
    "opens": "打开{app}",
    "back": "回到{app}",
    "hideLines": "不显示台词",
    "showLines": "显示台词"
  } },
  // BEGIN generated zh-Hant /COMPANION_ACTIVITY_WORDS/zh; OpenCC 0.1.7; s2twp
  get "zh-Hant"() { return COMPANION_ACTIVITY_WORDS_CACHE["zh-Hant"] ??= {
    "activity": "活動",
    "activityMenu": "活動...",
    "empty": "還沒有動靜",
    "ready": "待命",
    "finished": "做完了",
    "placeholder": "跟Claude說...",
    "send": "傳送",
    "sending": "正在傳送...",
    "unconfirmed": "不確定送到沒有",
    "retry": "重試",
    "expired": "超時了",
    "dictate": "聽寫",
    "newChat": "新對話",
    "newChatTerminal": "終端",
    "newChatDesktop": "Claude客戶端",
    "newChatVSCode": "VS Code外掛",
    "confirmClear": "清空{project}裡的這段對話?",
    "clear": "清空",
    "cancel": "取消",
    "close": "關閉",
    "badge": "{n}條新動態,開啟活動",
    "opens": "開啟{app}",
    "back": "回到{app}",
    "hideLines": "不顯示台詞",
    "showLines": "顯示台詞"
  } },
  // END generated zh-Hant

  get "ja"() { return COMPANION_ACTIVITY_WORDS_CACHE["ja"] ??= {
    "activity": "アクティビティ",
    "activityMenu": "アクティビティ...",
    "empty": "まだ何もない",
    "ready": "待機中",
    "finished": "終わった",
    "placeholder": "Claudeに伝える...",
    "send": "送信",
    "sending": "送信中...",
    "unconfirmed": "届いたかわからない",
    "retry": "再試行",
    "expired": "時間切れ",
    "dictate": "音声入力",
    "newChat": "新しいチャット",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "{project}の会話を消す?",
    "clear": "消す",
    "cancel": "やめる",
    "close": "閉じる",
    "badge": "新しいこと{n}件。アクティビティを開く",
    "opens": "{app}を開く",
    "back": "{app}に戻る",
    "hideLines": "セリフを隠す",
    "showLines": "セリフを出す"
  } },
  get "fr"() { return COMPANION_ACTIVITY_WORDS_CACHE["fr"] ??= {
    "activity": "Activité",
    "activityMenu": "Activité…",
    "empty": "Rien pour le moment.",
    "ready": "prêt",
    "finished": "terminé",
    "placeholder": "Dis quelque chose à Claude…",
    "send": "Envoyer",
    "sending": "Envoi…",
    "unconfirmed": "Pas sûr que ce soit arrivé",
    "retry": "Réessayer",
    "expired": "Délai dépassé",
    "dictate": "Dicter",
    "newChat": "Nouvelle conversation",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "Effacer cette conversation dans {project} ?",
    "clear": "Effacer",
    "cancel": "Annuler",
    "close": "Fermer",
    "badge": "{n} nouveautés. Ouvre Activité.",
    "opens": "Ouvre {app}.",
    "back": "Retour à {app}",
    "hideLines": "Masquer ses répliques",
    "showLines": "Afficher ses répliques"
  } },
  get "de"() { return COMPANION_ACTIVITY_WORDS_CACHE["de"] ??= {
    "activity": "Aktivität",
    "activityMenu": "Aktivität…",
    "empty": "Noch nichts.",
    "ready": "bereit",
    "finished": "fertig",
    "placeholder": "Sag Claude etwas…",
    "send": "Senden",
    "sending": "Wird gesendet…",
    "unconfirmed": "Unklar, ob es angekommen ist",
    "retry": "Erneut versuchen",
    "expired": "Zeit abgelaufen",
    "dictate": "Diktieren",
    "newChat": "Neuer Chat",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "Diese Unterhaltung in {project} löschen?",
    "clear": "Löschen",
    "cancel": "Abbrechen",
    "close": "Schließen",
    "badge": "{n} neue Meldungen. Öffnet Aktivität.",
    "opens": "Öffnet {app}.",
    "back": "Zurück zu {app}",
    "hideLines": "Seine Zeilen ausblenden",
    "showLines": "Seine Zeilen einblenden"
  } },
  get "hi"() { return COMPANION_ACTIVITY_WORDS_CACHE["hi"] ??= {
    "activity": "गतिविधि",
    "activityMenu": "गतिविधि…",
    "empty": "अभी कुछ नहीं।",
    "ready": "तैयार",
    "finished": "पूरा हुआ",
    "placeholder": "Claude से कहो…",
    "send": "भेजो",
    "sending": "भेज रहे हैं…",
    "unconfirmed": "पता नहीं पहुँचा या नहीं",
    "retry": "फिर कोशिश करो",
    "expired": "समय समाप्त",
    "dictate": "बोलकर लिखो",
    "newChat": "नई बातचीत",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "{project} में यह बातचीत मिटाएँ?",
    "clear": "मिटाओ",
    "cancel": "रद्द करो",
    "close": "बंद करो",
    "badge": "{n} नई सूचनाएँ। गतिविधि खोलता है।",
    "opens": "{app} खोलता है।",
    "back": "{app} पर वापस जाओ",
    "hideLines": "उसकी पंक्तियाँ छिपाओ",
    "showLines": "उसकी पंक्तियाँ दिखाओ"
  } },
  get "id"() { return COMPANION_ACTIVITY_WORDS_CACHE["id"] ??= {
    "activity": "Aktivitas",
    "activityMenu": "Aktivitas…",
    "empty": "Belum ada apa-apa.",
    "ready": "siap",
    "finished": "selesai",
    "placeholder": "Beri tahu Claude…",
    "send": "Kirim",
    "sending": "Mengirim…",
    "unconfirmed": "Belum pasti sampai",
    "retry": "Coba lagi",
    "expired": "Waktu habis",
    "dictate": "Dikte",
    "newChat": "Obrolan baru",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "Hapus percakapan ini di {project}?",
    "clear": "Hapus",
    "cancel": "Batal",
    "close": "Tutup",
    "badge": "{n} hal baru. Membuka Aktivitas.",
    "opens": "Membuka {app}.",
    "back": "Kembali ke {app}",
    "hideLines": "Sembunyikan ucapannya",
    "showLines": "Tampilkan ucapannya"
  } },
  get "it"() { return COMPANION_ACTIVITY_WORDS_CACHE["it"] ??= {
    "activity": "Attività",
    "activityMenu": "Attività…",
    "empty": "Ancora nulla.",
    "ready": "pronto",
    "finished": "finito",
    "placeholder": "Di' qualcosa a Claude…",
    "send": "Invia",
    "sending": "Invio…",
    "unconfirmed": "Non so se è arrivato",
    "retry": "Riprova",
    "expired": "Tempo scaduto",
    "dictate": "Detta",
    "newChat": "Nuova chat",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "Cancellare questa conversazione in {project}?",
    "clear": "Cancella",
    "cancel": "Annulla",
    "close": "Chiudi",
    "badge": "{n} novità. Apre Attività.",
    "opens": "Apre {app}.",
    "back": "Torna a {app}",
    "hideLines": "Nascondi le sue battute",
    "showLines": "Mostra le sue battute"
  } },
  get "ko"() { return COMPANION_ACTIVITY_WORDS_CACHE["ko"] ??= {
    "activity": "활동",
    "activityMenu": "활동…",
    "empty": "아직 아무것도 없어.",
    "ready": "준비됨",
    "finished": "완료",
    "placeholder": "Claude에게 말하기…",
    "send": "보내기",
    "sending": "보내는 중…",
    "unconfirmed": "도착했는지 모르겠어",
    "retry": "다시 시도",
    "expired": "시간 초과",
    "dictate": "받아쓰기",
    "newChat": "새 대화",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "{project}의 이 대화를 지울까?",
    "clear": "지우기",
    "cancel": "취소",
    "close": "닫기",
    "badge": "새 소식 {n}개. 활동을 엽니다.",
    "opens": "{app}를 엽니다.",
    "back": "{app}로 돌아가기",
    "hideLines": "대사 숨기기",
    "showLines": "대사 보이기"
  } },
  get "pt-BR"() { return COMPANION_ACTIVITY_WORDS_CACHE["pt-BR"] ??= {
    "activity": "Atividade",
    "activityMenu": "Atividade…",
    "empty": "Nada ainda.",
    "ready": "pronto",
    "finished": "terminou",
    "placeholder": "Fale com Claude…",
    "send": "Enviar",
    "sending": "Enviando…",
    "unconfirmed": "Não sei se chegou",
    "retry": "Tentar de novo",
    "expired": "Tempo esgotado",
    "dictate": "Ditar",
    "newChat": "Nova conversa",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "Limpar esta conversa em {project}?",
    "clear": "Limpar",
    "cancel": "Cancelar",
    "close": "Fechar",
    "badge": "{n} novidades. Abre Atividade.",
    "opens": "Abre {app}.",
    "back": "Voltar ao {app}",
    "hideLines": "Esconder as falas dele",
    "showLines": "Mostrar as falas dele"
  } },
  get "es-419"() { return COMPANION_ACTIVITY_WORDS_CACHE["es-419"] ??= {
    "activity": "Actividad",
    "activityMenu": "Actividad…",
    "empty": "Nada todavía.",
    "ready": "listo",
    "finished": "terminó",
    "placeholder": "Dile algo a Claude…",
    "send": "Enviar",
    "sending": "Enviando…",
    "unconfirmed": "No sé si llegó",
    "retry": "Reintentar",
    "expired": "Tiempo agotado",
    "dictate": "Dictar",
    "newChat": "Nueva conversación",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "¿Borrar esta conversación en {project}?",
    "clear": "Borrar",
    "cancel": "Cancelar",
    "close": "Cerrar",
    "badge": "{n} novedades. Abre Actividad.",
    "opens": "Abre {app}.",
    "back": "Volver a {app}",
    "hideLines": "Ocultar sus frases",
    "showLines": "Mostrar sus frases"
  } },
  get "es-ES"() { return COMPANION_ACTIVITY_WORDS_CACHE["es-ES"] ??= {
    "activity": "Actividad",
    "activityMenu": "Actividad…",
    "empty": "Aún nada.",
    "ready": "listo",
    "finished": "terminado",
    "placeholder": "Dile algo a Claude…",
    "send": "Enviar",
    "sending": "Enviando…",
    "unconfirmed": "No sé si llegó",
    "retry": "Reintentar",
    "expired": "Tiempo agotado",
    "dictate": "Dictar",
    "newChat": "Nueva conversación",
    "newChatTerminal": "Terminal",
    "newChatDesktop": "Claude app",
    "newChatVSCode": "VS Code",
    "confirmClear": "¿Borrar esta conversación en {project}?",
    "clear": "Borrar",
    "cancel": "Cancelar",
    "close": "Cerrar",
    "badge": "{n} novedades. Abre Actividad.",
    "opens": "Abre {app}.",
    "back": "Volver a {app}",
    "hideLines": "Ocultar sus frases",
    "showLines": "Mostrar sus frases"
  } },
}

const COMPANION_WORDS_CACHE: Partial<Record<View['lang'], Omit<CompanionWords, 'context'>>> = {}
const COMPANION_WORDS: Record<View['lang'], Omit<CompanionWords, 'context'>> = {
  get "en"() { return COMPANION_WORDS_CACHE["en"] ??= {
    ...COMPANION_CARD_WORDS["en"],
    ...COMPANION_ACTIVITY_WORDS["en"],
    pat: "pat coco's head", hide: 'Hide for an hour', home: 'Put Coco back', quit: 'Quit Coco Pet',
    size: 'Size', tiny: 'Extra small', small: 'Small', medium: 'Medium', large: 'Large', larger: 'Larger',
    patMenu: "Pat Coco's head", actions: "Actions", actWave: "Wave", actHug: "Hug", actFlustered: "Fluster", login: "Open at login", hideMenu: "Hide", hideHour: "For an hour", hideUntil: "Until I call Coco back",
  } },
  get "zh"() { return COMPANION_WORDS_CACHE["zh"] ??= {
    ...COMPANION_CARD_WORDS["zh"],
    ...COMPANION_ACTIVITY_WORDS["zh"],
    pat: '摸摸她的头', hide: '隐藏一小时', home: '放回原位', quit: '退出Coco Pet',
    size: '大小', tiny: '最小', small: '小', medium: '中', large: '大', larger: '更大',
    patMenu: "摸摸头", actions: "动作", actWave: "挥手", actHug: "抱抱", actFlustered: "手忙脚乱", login: "开机自启", hideMenu: "隐藏", hideHour: "一小时", hideUntil: "到我叫她回来",
  } },
  // BEGIN generated zh-Hant /COMPANION_WORDS/zh; OpenCC 0.1.7; s2twp
  get "zh-Hant"() { return COMPANION_WORDS_CACHE["zh-Hant"] ??= {
    ...COMPANION_CARD_WORDS["zh-Hant"],
    ...COMPANION_ACTIVITY_WORDS["zh-Hant"],
    pat: "摸摸她的頭", hide: "隱藏一小時", home: "放回原位", quit: "退出Coco Pet",
    size: "大小", tiny: "最小", small: "小", medium: "中", large: "大", larger: "更大",
    patMenu: "摸摸頭", actions: "動作", actWave: "揮手", actHug: "抱抱", actFlustered: "手忙腳亂", login: "開機自啟", hideMenu: "隱藏", hideHour: "一小時", hideUntil: "到我叫她回來",
  } },
  // END generated zh-Hant

  get "ja"() { return COMPANION_WORDS_CACHE["ja"] ??= {
    ...COMPANION_CARD_WORDS["ja"],
    ...COMPANION_ACTIVITY_WORDS["ja"],
    pat: '頭をなでる', hide: '1時間隠す', home: '元の位置に戻す', quit: 'Coco Petを終了',
    size: 'サイズ', tiny: '最小', small: '小', medium: '中', large: '大', larger: '特大',
    patMenu: "頭をなでる", actions: "アクション", actWave: "手を振る", actHug: "ハグ", actFlustered: "あたふたさせる", login: "ログイン時に開く", hideMenu: "隠す", hideHour: "1時間", hideUntil: "呼び戻すまで",
  } },
  get "fr"() { return COMPANION_WORDS_CACHE["fr"] ??= {
    ...COMPANION_CARD_WORDS["fr"],
    ...COMPANION_ACTIVITY_WORDS["fr"],
    pat: 'Caresser sa tête', hide: 'Masquer pendant une heure', home: 'La remettre à sa place', quit: 'Quitter Coco Pet',
    size: 'Taille', tiny: 'Très petit', small: 'Petit', medium: 'Moyen', large: 'Grand', larger: 'Plus grand',
    patMenu: "Caresser Coco", actions: "Actions", actWave: "Faire coucou", actHug: "Câlin", actFlustered: "Troubler", login: "Ouvrir à la connexion", hideMenu: "Masquer", hideHour: "Pendant une heure", hideUntil: "Jusqu'à ce que je rappelle Coco",
  } },
  get "de"() { return COMPANION_WORDS_CACHE["de"] ??= {
    ...COMPANION_CARD_WORDS["de"],
    ...COMPANION_ACTIVITY_WORDS["de"],
    pat: 'Ihr über den Kopf streicheln', hide: 'Eine Stunde ausblenden', home: 'An ihren Platz zurücksetzen', quit: 'Coco Pet beenden',
    size: 'Größe', tiny: 'Sehr klein', small: 'Klein', medium: 'Mittel', large: 'Groß', larger: 'Größer',
    patMenu: "Coco streicheln", actions: "Aktionen", actWave: "Winken", actHug: "Umarmen", actFlustered: "Aus der Fassung bringen", login: "Beim Anmelden öffnen", hideMenu: "Ausblenden", hideHour: "Eine Stunde", hideUntil: "Bis ich Coco zurückrufe",
  } },
  get "hi"() { return COMPANION_WORDS_CACHE["hi"] ??= {
    ...COMPANION_CARD_WORDS["hi"],
    ...COMPANION_ACTIVITY_WORDS["hi"],
    pat: 'उसके सिर पर हाथ फेरो', hide: 'एक घंटे के लिए छिपाओ', home: 'मूल जगह पर लौटाओ', quit: 'Coco Pet बंद करो',
    size: 'आकार', tiny: 'सबसे छोटा', small: 'छोटा', medium: 'मध्यम', large: 'बड़ा', larger: 'और बड़ा',
    patMenu: "Coco के सिर पर हाथ फेरो", actions: "हरकतें", actWave: "हाथ हिलाओ", actHug: "गले लगाओ", actFlustered: "बौखलाओ", login: "लॉगिन पर खोलो", hideMenu: "छिपाओ", hideHour: "एक घंटे के लिए", hideUntil: "जब तक मैं Coco को वापस न बुलाऊँ",
  } },
  get "id"() { return COMPANION_WORDS_CACHE["id"] ??= {
    ...COMPANION_CARD_WORDS["id"],
    ...COMPANION_ACTIVITY_WORDS["id"],
    pat: 'Elus kepalanya', hide: 'Sembunyikan selama satu jam', home: 'Kembalikan ke posisi semula', quit: 'Keluar dari Coco Pet',
    size: 'Ukuran', tiny: 'Paling kecil', small: 'Kecil', medium: 'Sedang', large: 'Besar', larger: 'Lebih besar',
    patMenu: "Elus kepala Coco", actions: "Aksi", actWave: "Melambai", actHug: "Peluk", actFlustered: "Bikin gugup", login: "Buka saat login", hideMenu: "Sembunyikan", hideHour: "Selama satu jam", hideUntil: "Sampai kupanggil kembali",
  } },
  get "it"() { return COMPANION_WORDS_CACHE["it"] ??= {
    ...COMPANION_CARD_WORDS["it"],
    ...COMPANION_ACTIVITY_WORDS["it"],
    pat: 'Accarezzale la testa', hide: 'Nascondi per un\'ora', home: 'Rimettila al suo posto', quit: 'Esci da Coco Pet',
    size: 'Dimensione', tiny: 'Piccolissimo', small: 'Piccolo', medium: 'Medio', large: 'Grande', larger: 'Più grande',
    patMenu: "Accarezza Coco", actions: "Azioni", actWave: "Saluta", actHug: "Abbraccia", actFlustered: "Manda nel pallone", login: "Apri al login", hideMenu: "Nascondi", hideHour: "Per un'ora", hideUntil: "Finché non richiamo Coco",
  } },
  get "ko"() { return COMPANION_WORDS_CACHE["ko"] ??= {
    ...COMPANION_CARD_WORDS["ko"],
    ...COMPANION_ACTIVITY_WORDS["ko"],
    pat: '머리 쓰다듬기', hide: '한 시간 숨기기', home: '원래 자리로 돌려놓기', quit: 'Coco Pet 종료',
    size: '크기', tiny: '아주 작게', small: '작게', medium: '보통', large: '크게', larger: '더 크게',
    patMenu: "코코 머리 쓰다듬기", actions: "동작", actWave: "손 흔들기", actHug: "안아주기", actFlustered: "당황시키기", login: "로그인 시 열기", hideMenu: "숨기기", hideHour: "한 시간", hideUntil: "내가 다시 부를 때까지",
  } },
  get "pt-BR"() { return COMPANION_WORDS_CACHE["pt-BR"] ??= {
    ...COMPANION_CARD_WORDS["pt-BR"],
    ...COMPANION_ACTIVITY_WORDS["pt-BR"],
    pat: 'Fazer carinho na cabeça dela', hide: 'Esconder por uma hora', home: 'Colocar de volta no lugar', quit: 'Fechar Coco Pet',
    size: 'Tamanho', tiny: 'Mínimo', small: 'Pequeno', medium: 'Médio', large: 'Grande', larger: 'Maior',
    patMenu: "Fazer carinho em Coco", actions: "Ações", actWave: "Acenar", actHug: "Abraçar", actFlustered: "Deixar sem jeito", login: "Abrir ao iniciar sessão", hideMenu: "Esconder", hideHour: "Por uma hora", hideUntil: "Até eu chamar de volta",
  } },
  get "es-419"() { return COMPANION_WORDS_CACHE["es-419"] ??= {
    ...COMPANION_CARD_WORDS["es-419"],
    ...COMPANION_ACTIVITY_WORDS["es-419"],
    pat: 'Acariciarle la cabeza', hide: 'Ocultar por una hora', home: 'Devolverla a su lugar', quit: 'Salir de Coco Pet',
    size: 'Tamaño', tiny: 'Muy pequeño', small: 'Pequeño', medium: 'Mediano', large: 'Grande', larger: 'Más grande',
    patMenu: "Acariciar a Coco", actions: "Acciones", actWave: "Saludar", actHug: "Abrazar", actFlustered: "Desconcertar", login: "Abrir al iniciar sesión", hideMenu: "Ocultar", hideHour: "Por una hora", hideUntil: "Hasta que vuelva a llamar a Coco",
  } },
  get "es-ES"() { return COMPANION_WORDS_CACHE["es-ES"] ??= {
    ...COMPANION_CARD_WORDS["es-ES"],
    ...COMPANION_ACTIVITY_WORDS["es-ES"],
    pat: 'Acariciarle la cabeza', hide: 'Ocultar durante una hora', home: 'Devolverla a su sitio', quit: 'Salir de Coco Pet',
    size: 'Tamaño', tiny: 'Muy pequeño', small: 'Pequeño', medium: 'Mediano', large: 'Grande', larger: 'Más grande',
    patMenu: "Acariciar a Coco", actions: "Acciones", actWave: "Saludar", actHug: "Abrazar", actFlustered: "Desconcertar", login: "Abrir al iniciar sesión", hideMenu: "Ocultar", hideHour: "Durante una hora", hideUntil: "Hasta que vuelva a llamar a Coco",
  } },
}

/** What the companion draws from. `at`, `session` and `desktop` are added when it is written. */
export type CompanionRecord = CompanionRequest & CompanionActivity & {
  task: string | null
  place?: string
  quota?: { rateLimits: { kind: string; percentUsed: number; resetsAt?: string; pace?: string; hot?: true }[] }
  dock?: { quota: string[] }
  companionTarget: CompanionTarget
  neighbours: boolean
  affection: View['affection']
  wakeLines: readonly string[]
  mood: View['mood']
  /** The person's latest request to bring him back, in ms since 1970. */
  summon?: number
  /** A visitor on him while he dozes, or just leaving; `label` is its accessibility phrase. */
  visitor?: NonNullable<View['visit']>
  /** The frame at rest: a loop's first frame, the open-eyed frame instead of a blink. */
  frame: Frame
  /** The mood's two-frame loop and its rate in ms, as the band runs it; null without one. */
  loop: readonly [Frame, Frame] | null
  every: number | null
  motion: typeof MOTION
  rest: boolean
  /** His line. */
  said: string | null
  pose?: View['pose']
  /** Claude's form when it is not Coco, her hoodie and her socks: the pet reads all three (Feed.swift). */
  claudie?: View['claudie']
  outfit?: View['outfit']
  socks?: View['socks']
  neighbourWords?: {busy:string;done:string}
  context: number | null
  estimate: boolean
  lang: View['lang']
  /** For VoiceOver: his name and the stage direction, in the session's language. */
  name: string
  aside: string
  words: CompanionWords & { shedAside: string; helpersAlt: string; ribbonAlt: string }
  ribbon?: View['ribbon']
  helpers?: View['helpers']
  shed?: View['shed']
  longTask?: View['longTask']
  /** The DM thread (dm.ts), while Talk is on: her messages the person has not seen, for the pet's unread mark; the newest
   *  that reached the closed thread, which the pet posts as the system's notification once (by its id) unless the screen
   *  is locked; and the thread's newest messages for the pet's DM window. */
  dm?: { unread: number; notice?: NonNullable<View['dmNotice']>; thread: CompanionDmLine[]; words: CompanionDmWords; notify: boolean }
  /** The stick of /coco focus while it burns (and for the two seconds it takes to go out), in ms since 1970. */
  stick?: { startedAt: number; endsAt: number }
  /** His reactions to the mouse on the companion, in the session's language. */
  reactions: Record<ReactionKey, readonly string[]>
}

function restingFrame(view: View): Frame {
  const loop = LOOPS[view.mood]
  if (loop && loop.frames.includes(view.frame)) return loop.frames[0]
  if (view.frame === 'idle-blink') return STILL.idle
  return view.frame
}

// Reuse the companion's existing accessible action name for the band picture.
export function companionPatLabel(lang: View['lang']): string {
  return COMPANION_WORDS[lang].pat
}

// Supplied 0.1.2 wake words, until B1's generated persona gains clingy.wake.
const CLINGY_WAKE_CACHE: Partial<Record<View['lang'], readonly string[]>> = {}
const CLINGY_WAKE: Record<View['lang'], readonly string[]> = {
  get "zh"() { return CLINGY_WAKE_CACHE["zh"] ??= ['(揉揉眼睛)你来啦', '醒了醒了。你一来我就醒了'] },
  // BEGIN generated zh-Hant /CLINGY_WAKE/zh; OpenCC 0.1.7; s2twp
  get "zh-Hant"() { return CLINGY_WAKE_CACHE["zh-Hant"] ??= ["(揉揉眼睛)你來啦", "醒了醒了。你一來我就醒了"] },
  // END generated zh-Hant

  get "en"() { return CLINGY_WAKE_CACHE["en"] ??= ["(rubs eyes) you're here.", "awake, awake. i always wake when you come."] },
  get "ja"() { return CLINGY_WAKE_CACHE["ja"] ??= ["(目をこする)来てくれたんだ", "起きた起きた。きみが来ると、すぐ起きちゃう"] },
  get "fr"() { return CLINGY_WAKE_CACHE["fr"] ??= ["(se frotte les yeux) tu es là.", "réveillée, réveillée. je me réveille toujours quand tu arrives."] },
  get "de"() { return CLINGY_WAKE_CACHE["de"] ??= ["(reibt sich die Augen) Du bist da.", "Wach, wach. Wenn du kommst, werde ich immer wach."] },
  get "hi"() { return CLINGY_WAKE_CACHE["hi"] ??= ["(आँखें मलती है) तुम आ गए।", "जाग गई, जाग गई। तुम्हारे आते ही मैं जाग जाती हूँ।"] },
  get "id"() { return CLINGY_WAKE_CACHE["id"] ??= ["(mengucek mata) kamu datang.", "sudah bangun. aku selalu bangun saat kamu datang."] },
  get "it"() { return CLINGY_WAKE_CACHE["it"] ??= ["(si strofina gli occhi) sei qui.", "sveglia, sveglia. mi sveglio sempre quando arrivi."] },
  get "ko"() { return CLINGY_WAKE_CACHE["ko"] ??= ["(눈을 비빈다) 왔구나.", "깼어, 깼어. 네가 오면 바로 깨게 돼."] },
  get "pt-BR"() { return CLINGY_WAKE_CACHE["pt-BR"] ??= ["(esfrega os olhos) você chegou.", "acordei, acordei. eu sempre acordo quando você chega."] },
  get "es-419"() { return CLINGY_WAKE_CACHE["es-419"] ??= ["(se frota los ojos) ya llegaste.", "despierta, despierta. siempre me despierto cuando llegas."] },
  get "es-ES"() { return CLINGY_WAKE_CACHE["es-ES"] ??= ["(se frota los ojos) ya estás aquí.", "despierta, despierta. siempre me despierto cuando llegas."] },
}

export function companionWakeLines(view: View): readonly string[] {
  const selected = linesFor(view, 'wake')
  return view.affection === 'clingy' && selected === linesFor({ ...view, affection: 'warm' }, 'wake')
    ? CLINGY_WAKE[view.lang] : selected
}

export function companionRecord(view: View): CompanionRecord {
  const loop = LOOPS[view.mood]
  const pose=view.pose?.name==='ribbon-glance'?view.companionPose??undefined:view.pose
  const line=view.line?.key==='two.first'?view.companionLine??undefined:view.line
  const words = WORDS[view.lang] ?? WORDS.en
  const settings = view as View & { companionTarget?: CompanionTarget; neighbours?: boolean }
  const direction=(view.stageDirection ?? pose?.aside ?? words.aside[view.mood] ?? '').replace(/\*/g,'')
  const folder=view.ribbon?.folder ?? activity.project
  const windows=(view.quota?.rateLimits ?? []).filter(w => (w.kind === 'five_hour' || w.kind === 'seven_day') && Number.isFinite(w.percentUsed))
  return {
    companionTarget: settings.companionTarget === 'claude' || settings.companionTarget === 'vscode' ? settings.companionTarget : 'auto',
    neighbours: settings.neighbours === true,
    affection: view.affection,
    wakeLines: companionWakeLines(view),
    ...activity,
    task: task === null ? null : TASK_WORDS[view.lang][task.key].replace(/\{(file|cmd|tool)\}/g, (_mark, key: 'file' | 'cmd' | 'tool') => task?.[key] ?? ''),
    // Where the task list is while it runs, in the band's own words («task 3/7»): the pet's task pill ends with it.
    ...(task !== null && view.place?.short ? { place: view.place.short } : {}),
    // The windows as Claude Code reports them, for the pet's Activity foot: whole percents, so a fraction does not
    // rewrite the file; a hot window carries the pace the band warned with.
    ...(windows.length ? { quota: { rateLimits: windows.map(w => {
      const pace = view.hotWindows?.includes(w.kind) ? view.paceDetails?.find(p => p.kind === w.kind)?.wide : undefined
      return { kind: w.kind, percentUsed: Math.round(w.percentUsed), ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}), ...(pace ? { pace, hot: true } : {}) }
    }) } } : {}),
    // The Dock tile on: its menu lists the windows as the band's battery and power bank read them.
    ...(dockTile ? { dock: { quota: quotaBandItems(view.lang as Lang, windows).map(item => item.alt).filter(Boolean) } } : {}),
    mood: view.mood,
    ...(lastSummon === undefined ? {} : { summon: lastSummon }),
    ...lastRequests,
    frame: restingFrame(view),
    loop: loop ? loop.frames : null,
    every: loop ? loop.every : null,
    motion: MOTION,
    rest: RESTING.has(view.mood),
    said: line?.text ?? view.said,
    ...(pose?{pose}:{}),
    // Until 10-18 these never reached the pet, so switching to Claudie on the Mac changed nothing there.
    ...(view.claudie?{claudie:view.claudie}:{}),...(view.outfit?{outfit:view.outfit}:{}),...(view.socks?{socks:view.socks}:{}),
    ...(settings.neighbours?{neighbourWords:{busy:c3Word(view.lang,'neighbour.busy'),done:c3Word(view.lang,'neighbour.done')}}:{}),
    context: view.context,
    estimate: view.estimate,
    lang: view.lang,
    name: view.lang === 'zh' ? '小克' : view.lang === 'ja' ? 'Coco' : view.lang === 'ko' ? '코코' : 'Coco',
    aside: direction,
    ...(view.ribbon ? {ribbon:view.ribbon}:{}),
    ...(view.helpers ? {helpers:view.helpers}:{}),
    ...(view.shed ? {shed:view.shed}:{}),
    ...(view.visit ? {visitor:{id:view.visit.id,kind:view.visit.kind,at:view.visit.at,...(view.visit.leftAt!==undefined?{leftAt:view.visit.leftAt}:{}),...(view.visit.label?{label:view.visit.label}:{})}}:{}),
    ...(view.play?.stick ? {stick:{startedAt:view.play.stick.startedAt,endsAt:view.play.stick.endsAt}}:{}),
    ...(dmOn ? {dm:{unread:view.dm?.unread ?? 0,...(view.dmNotice ? {notice:{...view.dmNotice}} : {}),thread:dmThread.map(line => ({ ...line })),words:{ ...dmWords },notify:dmNotify}} : {}),
    ...(view.longTask ? {longTask:{...view.longTask,title:view.lang === 'zh' ? '小克' : view.lang === 'ja' ? 'Coco' : view.lang === 'ko' ? '코코' : 'Coco'}}:{}),
    words: { ...(COMPANION_WORDS[view.lang] ?? COMPANION_WORDS.en!), context: words.context,
      shedAside:d1Word(view.lang,'aside.shed').replace(/\*/g,''),
      helpersAlt:d1Word(view.lang,'helpers.alt',{n:view.helpersCount??0},view.helpersCount??0),
      ribbonAlt:d1Word(view.lang,'ribbon.alt',{folder}) },
    reactions: COMPANION_REACTIONS[view.lang] ?? COMPANION_REACTIONS.en!,
  }
}

function companionStageText(source: string, slots: readonly LineValue[] = []): string {
  if (!source.includes('*')) return source
  const values = [...slots.map(slot => slot.value), '(*´ω`*)']
  const protectedRanges: { start: number; end: number }[] = []
  let offset = 0
  for (const part of lineParts(source, values)) {
    if (part.slot) protectedRanges.push({ start: offset, end: offset + part.text.length })
    offset += part.text.length
  }
  let text = '', opening = -1, at = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '*' || protectedRanges.some(range => i >= range.start && i < range.end)) continue
    if (opening >= 0 && i > opening + 1 && !source.slice(opening + 1, i).includes('\n')) {
      text += source.slice(at, opening) + source.slice(opening + 1, i)
      at = i + 1; opening = -1
    } else opening = i
  }
  return text + source.slice(at)
}

function companionPresence(presence: Record<string, unknown>, rawSaid: string | null, said: string | null): Record<string, unknown> {
  const projected = { ...presence }
  if (typeof presence.said === 'string') projected.said = presence.said === rawSaid ? said : companionStageText(presence.said)
  if (presence.lines && typeof presence.lines === 'object' && !Array.isArray(presence.lines)) {
    projected.lines = Object.fromEntries(Object.entries(presence.lines).map(([lang, pool]) => {
      if (!pool || typeof pool !== 'object' || Array.isArray(pool)) return [lang, pool]
      const lines = { ...pool as Record<string, unknown> }
      for (const key of ['sleep', 'wake', 'idle']) {
        const held = lines[key]
        if (Array.isArray(held) && held.every(line => typeof line === 'string')) lines[key] = held.map(line => companionStageText(line))
      }
      return [lang, lines]
    }))
  }
  return projected
}

/**
 * The record as compact JSON, without time or session: what push() compares with the last one
 * it wrote. Equal keys mean nothing the companion shows has changed, so nothing is written.
 */
export function companionKey(view: View, presence?: Record<string, unknown>): string {
  const raw = companionRecord(view)
  const said = raw.said === null ? null : displaySlots(raw.said, view.line?.slots)
  const reactions = { ...raw.reactions }
  for (const key of Object.keys(reactions) as ReactionKey[]) reactions[key] = reactions[key].map(line => companionStageText(line))
  const record: CompanionRecord = {
    ...raw,
    said: said === null ? null : companionStageText(said.text, said.slots),
    aside: companionStageText(raw.aside),
    ...(raw.pose ? { pose: { ...raw.pose, aside: companionStageText(raw.pose.aside) } } : {}),
    wakeLines: raw.wakeLines.map(line => companionStageText(line)),
    reactions,
  }
  return JSON.stringify({ ...record, ...(presence ? { presence: companionPresence(presence, raw.said, record.said) } : {}) })
}

/** The file's whole text for a key from companionKey: version, session, desktop, time, record. */
export function companionText(key: string, session: string, desktop: boolean, at: number, surfaces?: readonly string[]): string {
  if (surfaces !== undefined) key = JSON.stringify({ ...JSON.parse(key), surfaces })
  const head = `{"v":1,"session":${JSON.stringify(session)},"desktop":${desktop},"at":${Math.round(at)}`
  return key.length > 2 ? `${head},${key.slice(1)}\n` : `${head}}\n`
}

/** Written once when a session ends, so the companion stops showing it. */
export function companionEnded(session: string, at: number): string {
  companionTask(null)
  companionActivity({ reply: null, notice: null, waitAt: null, channel: false })
  return `{"v":1,"session":${JSON.stringify(session)},"at":${Math.round(at)},"ended":true,"task":null,"reply":null,"notice":null,"channel":false}\n`
}

/** A summon uses the current record, with no new line and no mood change. */
export function companionSummonText(view: View, session: string, desktop: boolean, at: number): string {
  lastSummon = Math.round(at)
  return companionText(companionKey(view), session, desktop, at)
}

/** A book press carries this session's complete record, including earlier requests. */
export function companionRequestText(view: View, session: string, desktop: boolean, at: number, request: CompanionRequest): string {
  if (request.summon !== undefined) lastSummon = Math.round(request.summon)
  const { summon: _summon, ...other } = request
  lastRequests = { ...lastRequests, ...other }
  return companionText(companionKey(view), session, desktop, at)
}
