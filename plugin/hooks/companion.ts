import { MOTION } from './motion'
// The companion feed: what Claude-sama is doing now, for the companion app that stands beside the
// Claude desktop app's window (plugin/companion, macOS only, installed by /claudesama:companion).
//
// register.tsx's push() atomically replaces the feed, and only when two things hold:
// the record changed (blinks and loop frames do not change it: the companion runs the loop
// itself), and the companion's folder exists. `install` creates that folder and `uninstall`
// moves it to the Trash, so nobody without the companion ever gets a file.
//
// Where: ~/Library/Application Support/Claude-sama/view.json. His settings and this feed
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

import { LOOPS, STILL } from './mood'
import { WORDS } from './words'
import { basename, middleCut } from './tasks'
import type { TaskDescription } from './tasks'
import type { ClaudesamaView as View, CompanionActivity } from '../types'

/** The companion's folder, under HOME. It exists only while the companion is installed. */
export const COMPANION_DIR = 'Library/Application Support/Claude-sama'
/** The feed file, under HOME. */
export const COMPANION_FEED = `${COMPANION_DIR}/view.json`

// Keep a summon in later mood records too: a busy session must not erase the button's press
// before the companion reads it. This is a time stamp, not a new line or a change of mood.
let lastSummon: number | undefined

export type CompanionRequest = {
  summon?: number
  follow?: number
  settings?: number
  size?: { to: 'tiny' | 'small' | 'medium' | 'large'; at: number }
  login?: { on: boolean; at: number }
}
// Like summons, requests survive later mood writes until the app has read the feed.
let lastRequests: Omit<CompanionRequest, 'summon'> = {}

let activity: CompanionActivity = emptyActivity()
let task: TaskDescription | null = null

function emptyActivity(): CompanionActivity {
  return { project: '', done: null, waitAt: null, reply: null, notice: null, ack: null, channel: false }
}

/** A fresh session owns its own Activity and book requests. */
export function companionSession(root: string): void {
  activity = { ...emptyActivity(), project: middleCut(basename(root), 24) }
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

export function companionSeen(upto: number): void {
  if (activity.reply && activity.reply.at <= upto) activity.reply = null
  if (activity.notice && activity.notice.at <= upto) activity.notice = null
}

type Frame = View['frame']
export type CompanionWords = {
  followMenu: string; offerTitle: string; offerBody: string; yes: string; later: string; waitTitle: string; waitBody: string; open: string; close: string; thanks: string
  pat: string; hide: string; home: string; quit: string; size: string; tiny: string; small: string; medium: string; large: string; context: string
  activity: string; activityMenu: string; empty: string; ready: string; finished: string; placeholder: string; send: string; sending: string; unconfirmed: string; retry: string; expired: string; dictate: string; newChat: string; confirmClear: string; clear: string; cancel: string; badge: string; opens: string; back: string; hideLines: string; showLines: string
}

// Nothing going on: such a session never takes the companion from one that is working or waiting.
const RESTING: ReadonlySet<View['mood']> = new Set(['idle', 'sleep'])

// The companion's own few words, sent with each record in the session's language: the VoiceOver
// hint on his sprite and his right-click menu (size, hide, put back, quit). A language without
// its own set gets English.
// What he does when you touch him on the companion, and what he says then. Each key is a reaction:
//   pat        one click: a head pat (he blushes)
//   flustered  several quick clicks
//   drag       you pick him up
//   drop       you put him down (he smooths his robe)
//   hold       a long press (he hugs his book)
//   shiori     an Option-click (Shiori, 小白 in Chinese, peeks out)
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
//   - Chinese and Japanese band speech, omen slips, reactions, menus and card lines use ASCII
//     commas, question/exclamation marks, colons, semicolons, parentheses and straight quotes;
//     every ellipsis is three ASCII dots, with no padding inside CJK text
//   - Japanese keeps only 、 。 「 」 full-width; Chinese keeps sentence-internal 。, 《 》
//     and the owner's chosen ～; category brackets and stage-direction asterisks use ASCII
//   - Latin words and numbers touch adjacent Han, hiragana and katakana; preserve kaomoji
//     line breaks and readable commands and paths
//   - in Chinese he is never called a god (the words tools/tests/language.test.tsx forbids); 小神 is fine
// TODO(localizer): add the same six keys, in this style, for fr, de, hi, id, it, ko, pt-BR,
// es-419, es-ES (a language without its own set gets English): pat, flustered, drag, drop, hold,
// shiori, 4 to 6 lines each.
export type ReactionKey = 'pat' | 'flustered' | 'drag' | 'drop' | 'hold' | 'shiori'
const COMPANION_REACTIONS: Partial<Record<View['lang'], Record<ReactionKey, readonly string[]>>> = {
  en: {
    pat: ['so warm ww', 'my bow\'s crooked now\n(*´ω`*)', 'hehe 🌸', '(soft pats)\n˘ᵕ˘', 'purrr 🐱'],
    flustered: ['too fast\n>_<', 'stop poking me\n//ω//', 'i\'m getting dizzy\n@_@', 'i\'m not a button\n(>д<)', 'shiori might bite 🐍', 'ahhh wait 💦'],
    drag: ['we\'re flying ✈️', 'where to next\no.o', 'hold me steady\n(⊙_⊙)', 'airborne kami ✨', 'don\'t drop me\n>~<'],
    drop: ['safe landing 🛬', '(smooths his robe)\nu_u', 'that was fun\n^_^', 'nice spot 🌿', 'plop ☁️'],
    hold: ['squish\n>_<', 'i\'m tiny, you know\n(´･ω･`)', '(hugs his book) 📖', 'shiori\'s asleep now 💤'],
    shiori: ['hiss 🐍', 'she wants a snack 🍎', 'such a drama queen 💅', 'say hi to shiori\no_o', 'she says she\'s hungry 🍽️'],
  },
  zh: {
    pat: ['好暖呀ww', '蝴蝶结要歪啦\n(*´ω`*)', '嘿嘿🌸', '(摸摸头)\n˘ᵕ˘', '咕噜噜～🐱'],
    flustered: ['太快啦\n>_<', '别一直戳我\n//ω//', '要转晕了\n@_@', '我不是按钮\n(>д<)', '小白要咬人了🐍', '啊等等💦'],
    drag: ['飞起来啦✈️', '去哪儿呀\no.o', '拿稳一点\n(⊙_⊙)', '小神起飞✨', '别摔着我\n>~<'],
    drop: ['安全着陆🛬', '(理理衣服)\nu_u', '还挺好玩\n^_^', '这儿不错🌿', '吧唧☁️'],
    hold: ['被捏住了\n>_<', '我很小的\n(´･ω･`)', '(抱紧书)📖', '小白睡着了💤'],
    shiori: ['嘶嘶🐍', '她想要零食🍎', '真是个戏精💅', '跟小白打个招呼\no_o', '她说她饿了🍽️'],
  },
  ja: {
    pat: ['あったかいww', 'リボン曲がっちゃう\n(*´ω`*)', 'えへへ🌸', '*なでなで*\n˘ᵕ˘', 'ゴロゴロ~🐱'],
    flustered: ['はやすぎ\n>_<', 'つつかないで\n//ω//', '目が回る\n@_@', 'ボタンじゃないってば\n(>д<)', 'シオリがかむかもよ🐍', 'あーっ待って💦'],
    drag: ['飛んでる✈️', '次はどこ\no.o', 'しっかり持って\n(⊙_⊙)', '空飛ぶ神さま✨', '落とさないでね\n>~<'],
    drop: ['ぶじ着陸🛬', '服を直すね\nu_u', '楽しかった\n^_^', 'いい場所だね🌿', 'ぽすっ☁️'],
    hold: ['ぎゅー\n>_<', '僕、ちっちゃいんだから\n(´･ω･`)', '*本をぎゅっ*📖', 'シオリはいま寝てる💤'],
    shiori: ['シャー🐍', 'おやつがほしいって🍎', 'ほんとドラマクイーンなんだから💅', 'シオリにあいさつして\no_o', 'おなかすいたって🍽️'],
  },
  'fr': {
    pat: ['hihi, ça chatouille 🌸', 'mes joues chauffent\n(//ω//)', 'mon nœud est de travers\n^_^', 'encore une petite caresse ? 🐱'],
    flustered: ['doucement, ça tourne\n@_@', 'je suis pas un bouton\n>_<', 'attends, je vois double\n(⊙_⊙)', 'mes idées dérapent 💫'],
    drag: ['oh, je décolle ✈️', 'tu m\'emmènes où\no.o', 'tiens-moi bien\n(⊙_⊙)', 'un kami dans les airs ✨'],
    drop: ['atterrissage en douceur ☁️', 'je remets ma robe en place\nu_u', 'hop, mon nœud aussi\n^_^', 'pas mal, cet endroit 🌿'],
    hold: ['je serre mon livre 📖', 'je tiens dans ta main\n(´･ω･`)', 'oh, j\'avais presque fini de dormir 💤', 'je reste bien au chaud\n^_^'],
    shiori: ['tiens, shiori montre le bout du nez 🐍', 'elle te regarde, là\no.o', 'elle me chatouille la manche 🍃', 'la voilà, toute fière ✨'],
  },
  'de': {
    pat: ['Huch, ich werde rot 🌸', 'Das kitzelt am Kopf\n(//ω//)', 'Jetzt sitzt die Schleife schief\n^_^', 'Noch ein Streichler? 🐱'],
    flustered: ['Langsam, mir wird schwindlig\n@_@', 'Ich bin doch kein Knopf\n>_<', 'Warte, ich muss mich sortieren\n(⊙_⊙)', 'Meine Schleife dreht sich mit 💫'],
    drag: ['Huch, ich fliege ✈️', 'Wohin geht\'s\no.o', 'Halt mich gut fest\n(⊙_⊙)', 'Ein Kami hebt ab ✨'],
    drop: ['Wieder Boden unter den Füßen ☁️', 'Erst mal mein Gewand glätten\nu_u', 'Meine Schleife sitzt wieder\n^_^', 'Hier bleib ich 🌿'],
    hold: ['Mein Buch muss mit 📖', 'Ich passe ja in eine Hand\n(´･ω･`)', 'Bin noch ein bisschen schläfrig 💤', 'So ist es ganz gemütlich\n^_^'],
    shiori: ['Shiori lugt hervor 🐍', 'Sie guckt dich an\no.o', 'Sie kitzelt mich am Ärmel 🍃', 'Jetzt tut sie ganz unschuldig ✨'],
  },
  'hi': {
    pat: ['अरे, गाल गर्म हो गए 🌸', 'ज़रा धीरे, रिबन टेढ़ा हो जाएगा\n>_<', 'हम्म\n^_^', 'अरे, मैं तो शरमा गया 🐱'],
    flustered: ['इतनी जल्दी-जल्दी? चक्कर आ रहे हैं\n@_@', 'अरे, मैं बटन थोड़ी हूँ\n>_<', 'ज़रा रुको, हँसी सँभाल लूँ 🫣', 'सब घूम रहा है 🌀'],
    drag: ['अरे, मैं उड़ रहा हूँ ✨', 'कहाँ ले जा रहे हो\no.o', 'ज़रा ठीक से थामना\n>_<', 'मेरा रिबन भी उड़ रहा है 🎀'],
    drop: ['लो, पाँव फिर ज़मीन पर 🐾', 'ज़रा चोगा सीधा कर लूँ\n^_^', 'यह जगह अच्छी है\no.o', 'धप्प, उतर गया ✨'],
    hold: ['अरे, थोड़ा दब गया\n>_<', 'अपनी किताब कसकर पकड़ लूँ 📖', 'अरे, मेरी आस्तीन फँस गई\no.o', 'इतनी गर्माहट, नींद आ रही है 💤'],
    shiori: ['शिओरी झाँक रही है 🐍', 'उसे भी नमस्ते कहो\n^_^', 'लगता है, उसे कुछ खाने को चाहिए\no.o', 'देखो, उसकी नन्ही जीभ ✨'],
  },
  'id': {
    pat: ['eh, pipiku jadi panas 🌸', 'pelan-pelan, pitaku bisa miring\n>_<', 'hehe\n^_^', 'aku jadi salting nih 😳'],
    flustered: ['eh, pelan dulu\n@_@', 'kliknya cepat banget\n>_<', 'aku bukan tombol, lho 🫣', 'kepalaku muter 🌀'],
    drag: ['wah, terbang ✨', 'mau dibawa ke mana\no.o', 'pegang yang mantap, ya\n>_<', 'pitaku ikut terbang 🎀'],
    drop: ['nah, kaki menapak lagi 🐾', 'bentar, kurapikan jubahku\n^_^', 'empuk juga tempat ini 🧸', 'mendarat mulus ✨'],
    hold: ['ih, aku jadi penyet\n>_<', 'bukunya kupeluk erat 📖', 'bentar, lengan bajuku nyangkut\no.o', 'hangat juga dipegang begini 🌸'],
    shiori: ['shiori ngintip tuh 🐍', 'dia minta camilan 🍎', 'eh, lidah kecilnya keluar\no.o', 'sapa shiori juga, ya\n^_^'],
  },
  'it': {
    pat: ['oh, mi fai arrossire 🌸', 'mi hai spettinato\n(//ω//)', 'il fiocco è tutto storto\n^_^', 'ancora una carezza? 🐱'],
    flustered: ['piano, mi gira la testa\n@_@', 'non sono un pulsante\n>_<', 'aspetta, vedo doppio\n(⊙_⊙)', 'aiuto, sto girando 💫'],
    drag: ['oh, sto volando ✈️', 'dove mi porti\no.o', 'tienimi bene\n(⊙_⊙)', 'un kami in decollo ✨'],
    drop: ['atterraggio morbido ☁️', 'mi sistemo la veste\nu_u', 'anche il fiocco è a posto\n^_^', 'qui si sta bene 🌿'],
    hold: ['stringo il libro al petto 📖', 'sto tutto in una mano\n(´･ω･`)', 'ancora mezzo addormentato 💤', 'qui si sta al calduccio\n^_^'],
    shiori: ['shiori fa capolino 🐍', 'ti sta guardando\no.o', 'mi fa il solletico nella manica 🍃', 'ora fa la timidona ✨'],
  },
  'ko': {
    pat: ['앗, 볼 빨개졌잖아 🌸', '살살, 리본 삐뚤어져\n>_<', '헤헤\n^_^', '간지러운데 좋다 🐱'],
    flustered: ['앗, 너무 빨라\n@_@', '잠깐만, 어질어질해\n>_<', '나 버튼 아니거든 🫣', '손가락이 몇 개야\no.o'],
    drag: ['우와, 날아간다 ✨', '어디로 가는 거야\no.o', '살짝만 잡아 줘\n>_<', '리본까지 날리네 🎀'],
    drop: ['휴, 발이 닿았다 🐾', '잠깐, 소매 좀 펴고\n^_^', '여기 괜찮은데\no.o', '착륙 성공 ✨'],
    hold: ['으앗, 납작해져\n>_<', '책은 내가 꼭 안을게 📖', '잠깐, 소매가 끼었어\no.o', '따뜻해서 졸려 💤'],
    shiori: ['시오리 빼꼼 🐍', '시오리한테도 인사해 줘\n^_^', '간식 찾는 눈인데\no.o', '아, 혀 내밀었다 ✨'],
  },
  'pt-BR': {
    pat: ['ai, fiquei corado 🌸', 'esse cafuné veio na hora certa\n^_^', 'meu laço saiu do lugar\n:3', 'hehe, que cócegas ✨'],
    flustered: ['ei, quantos dedos você tem?\n@_@', 'tô ficando tonto 💫', 'calma, não sou botão\n>_<', 'já perdi a conta 😵'],
    drag: ['opa, decolamos ✈️', 'pra onde a gente vai?\no.o', 'me segura direitinho 😳', 'kami voador por um dia ✨'],
    drop: ['pouso macio 🛬', 'deixa eu ajeitar a roupa\nu_u', 'pronto, laço no lugar 🎀', 'até que foi divertido\n^_^'],
    hold: ['ai, virei bolinho\n:3', 'vou abraçar meu livro 📖', 'um segundo, minha manga prendeu 😳', 'a shiori ficou quietinha também 🐍'],
    shiori: ['psiu... a shiori apareceu 🐍', 'ela veio ver a bagunça\no.o', 'finge que não viu, ela é tímida 🌸', 'ela tá de olho no lanche 🍓'],
  },
  'es-419': {
    pat: ['ay, me puse rojo 🌸', 'ese cariño sí me despierta\n^_^', 'se me movió el moño\n:3', 'jeje, cosquillas ✨'],
    flustered: ['¿cuántos clics van?\n@_@', 'me estoy mareando 💫', 'oye, no soy botón\n>_<', 'ya perdí la cuenta 😵'],
    drag: ['¡epa, al aire! ✈️', '¿a dónde vamos?\no.o', 'sujétame bien 😳', 'un kami volador ✨'],
    drop: ['aterrizaje suave 🛬', 'déjame acomodar la ropa\nu_u', 'el moño sigue en su sitio 🎀', 'otra vueltecita después\n^_^'],
    hold: ['quedé hecho bolita\n:3', 'abrazo mi libro por si acaso 📖', 'espera, se arrugó mi manga 😳', 'shiori también se quedó quietita 🐍'],
    shiori: ['shhh... salió shiori 🐍', 'vino a ver qué pasa\no.o', 'hoy anda curiosa ✨', 'seguro olió algún bocadito 🍎'],
  },
  'es-ES': {
    pat: ['ay, me he puesto colorado 🌸', 'eso sí que ha sido un mimo\n^_^', 'se me ha torcido el lazo\n:3', 'je, qué cosquillas ✨'],
    flustered: ['¿cuántos clics llevamos?\n@_@', 'me estás mareando 💫', 'eh, que no soy un botón\n>_<', 'ya no sé dónde mirar 😵'],
    drag: ['¡anda, estoy volando! ✈️', '¿adónde vamos?\no.o', 'sujétame bien 😳', 'un kami por los aires ✨'],
    drop: ['aterrizaje blandito 🛬', 'voy a alisarme la ropa\nu_u', 'el lazo sigue en su sitio 🎀', 'ha estado bien\n^_^'],
    hold: ['me has hecho una bolita\n:3', 'agarro bien mi libro 📖', 'espera, se me engancha la manga 😳', 'shiori se ha quedado quietecita 🐍'],
    shiori: ['chsss... ha salido shiori 🐍', 'se ha asomado a cotillear\no.o', 'hoy está curiosa ✨', 'creo que ha olido algo de comer 🍎'],
  },
}

const COMPANION_CARD_WORDS: Record<View['lang'], Pick<CompanionWords, 'followMenu' | 'offerTitle' | 'offerBody' | 'yes' | 'later' | 'waitTitle' | 'waitBody' | 'open' | 'close' | 'thanks'>> = {
  "en": {
    "followMenu": "Let him follow the window…",
    "offerTitle": "May I follow your window?",
    "offerBody": "Then I can stay right beside it. I only see where it is.",
    "yes": "Yes, follow it",
    "later": "Not now",
    "waitTitle": "Switch me on in System Settings",
    "waitBody": "Privacy & Security › Accessibility",
    "open": "Open System Settings",
    "close": "Close",
    "thanks": "thanks, i'll keep up with your window ✨"
  },
  "zh": {
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
  },
  "ja": {
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
  },
  "fr": {
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
  },
  "de": {
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
  },
  "hi": {
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
  },
  "id": {
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
  },
  "it": {
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
  },
  "ko": {
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
  },
  "pt-BR": {
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
  },
  "es-419": {
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
  },
  "es-ES": {
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
  }
}

export type TaskKey = 'thinking' | 'reading' | 'editing' | 'running' | 'searching' | 'web' | 'helper' | 'planning' | 'using' | 'waitingOK' | 'waitingAnswer'

/** The bubble phrases: only placeholders receive a filename, program or short tool name. */
export const TASK_WORDS: Record<View['lang'], Record<TaskKey, string>> = {
  "en": {
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
  },
  "zh": {
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
  },
  "ja": {
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
  },
  "fr": {
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
  },
  "de": {
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
  },
  "hi": {
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
  },
  "id": {
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
  },
  "it": {
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
  },
  "ko": {
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
  },
  "pt-BR": {
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
  },
  "es-419": {
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
  },
  "es-ES": {
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
  }
}

const COMPANION_ACTIVITY_WORDS: Record<View['lang'], Pick<CompanionWords, 'activity' | 'activityMenu' | 'empty' | 'ready' | 'finished' | 'placeholder' | 'send' | 'sending' | 'unconfirmed' | 'retry' | 'expired' | 'dictate' | 'newChat' | 'confirmClear' | 'clear' | 'cancel' | 'close' | 'badge' | 'opens' | 'back' | 'hideLines' | 'showLines'>> = {
  "en": {
    "activity": "Activity",
    "activityMenu": "Activity…",
    "empty": "Nothing yet.",
    "ready": "ready",
    "finished": "finished",
    "placeholder": "Tell Claude in {project}…",
    "send": "Send",
    "sending": "Sending…",
    "unconfirmed": "Not sure it arrived",
    "retry": "Retry",
    "expired": "Timed out",
    "dictate": "Dictate",
    "newChat": "New chat",
    "confirmClear": "Clear this conversation in {project}?",
    "clear": "Clear",
    "cancel": "Cancel",
    "close": "Close",
    "badge": "{n} new. Opens Activity.",
    "opens": "Opens Claude.",
    "back": "Back to Claude",
    "hideLines": "Hide his lines",
    "showLines": "Show his lines"
  },
  "zh": {
    "activity": "活动",
    "activityMenu": "活动...",
    "empty": "还没有动静",
    "ready": "待命",
    "finished": "做完了",
    "placeholder": "在{project}里跟Claude说...",
    "send": "发送",
    "sending": "正在发送...",
    "unconfirmed": "不确定送到没有",
    "retry": "重试",
    "expired": "超时了",
    "dictate": "听写",
    "newChat": "新对话",
    "confirmClear": "清空{project}里的这段对话?",
    "clear": "清空",
    "cancel": "取消",
    "close": "关闭",
    "badge": "{n}条新动态,打开活动",
    "opens": "打开Claude",
    "back": "回到Claude",
    "hideLines": "不显示台词",
    "showLines": "显示台词"
  },
  "ja": {
    "activity": "アクティビティ",
    "activityMenu": "アクティビティ...",
    "empty": "まだ何もない",
    "ready": "待機中",
    "finished": "終わった",
    "placeholder": "{project}でClaudeに伝える...",
    "send": "送信",
    "sending": "送信中...",
    "unconfirmed": "届いたかわからない",
    "retry": "再試行",
    "expired": "時間切れ",
    "dictate": "音声入力",
    "newChat": "新しいチャット",
    "confirmClear": "{project}の会話を消す?",
    "clear": "消す",
    "cancel": "やめる",
    "close": "閉じる",
    "badge": "新しいこと{n}件。アクティビティを開く",
    "opens": "Claudeを開く",
    "back": "Claudeに戻る",
    "hideLines": "セリフを隠す",
    "showLines": "セリフを出す"
  },
  "fr": {
    "activity": "Activité",
    "activityMenu": "Activité…",
    "empty": "Rien pour le moment.",
    "ready": "prêt",
    "finished": "terminé",
    "placeholder": "Dis quelque chose à Claude dans {project}…",
    "send": "Envoyer",
    "sending": "Envoi…",
    "unconfirmed": "Pas sûr que ce soit arrivé",
    "retry": "Réessayer",
    "expired": "Délai dépassé",
    "dictate": "Dicter",
    "newChat": "Nouvelle conversation",
    "confirmClear": "Effacer cette conversation dans {project} ?",
    "clear": "Effacer",
    "cancel": "Annuler",
    "close": "Fermer",
    "badge": "{n} nouveautés. Ouvre Activité.",
    "opens": "Ouvre Claude.",
    "back": "Retour à Claude",
    "hideLines": "Masquer ses répliques",
    "showLines": "Afficher ses répliques"
  },
  "de": {
    "activity": "Aktivität",
    "activityMenu": "Aktivität…",
    "empty": "Noch nichts.",
    "ready": "bereit",
    "finished": "fertig",
    "placeholder": "Sag Claude in {project} etwas…",
    "send": "Senden",
    "sending": "Wird gesendet…",
    "unconfirmed": "Unklar, ob es angekommen ist",
    "retry": "Erneut versuchen",
    "expired": "Zeit abgelaufen",
    "dictate": "Diktieren",
    "newChat": "Neuer Chat",
    "confirmClear": "Diese Unterhaltung in {project} löschen?",
    "clear": "Löschen",
    "cancel": "Abbrechen",
    "close": "Schließen",
    "badge": "{n} neue Meldungen. Öffnet Aktivität.",
    "opens": "Öffnet Claude.",
    "back": "Zurück zu Claude",
    "hideLines": "Seine Zeilen ausblenden",
    "showLines": "Seine Zeilen einblenden"
  },
  "hi": {
    "activity": "गतिविधि",
    "activityMenu": "गतिविधि…",
    "empty": "अभी कुछ नहीं।",
    "ready": "तैयार",
    "finished": "पूरा हुआ",
    "placeholder": "{project} में Claude से कहो…",
    "send": "भेजो",
    "sending": "भेज रहे हैं…",
    "unconfirmed": "पता नहीं पहुँचा या नहीं",
    "retry": "फिर कोशिश करो",
    "expired": "समय समाप्त",
    "dictate": "बोलकर लिखो",
    "newChat": "नई बातचीत",
    "confirmClear": "{project} में यह बातचीत मिटाएँ?",
    "clear": "मिटाओ",
    "cancel": "रद्द करो",
    "close": "बंद करो",
    "badge": "{n} नई सूचनाएँ। गतिविधि खोलता है।",
    "opens": "Claude खोलता है।",
    "back": "Claude पर वापस जाओ",
    "hideLines": "उसकी पंक्तियाँ छिपाओ",
    "showLines": "उसकी पंक्तियाँ दिखाओ"
  },
  "id": {
    "activity": "Aktivitas",
    "activityMenu": "Aktivitas…",
    "empty": "Belum ada apa-apa.",
    "ready": "siap",
    "finished": "selesai",
    "placeholder": "Beri tahu Claude di {project}…",
    "send": "Kirim",
    "sending": "Mengirim…",
    "unconfirmed": "Belum pasti sampai",
    "retry": "Coba lagi",
    "expired": "Waktu habis",
    "dictate": "Dikte",
    "newChat": "Obrolan baru",
    "confirmClear": "Hapus percakapan ini di {project}?",
    "clear": "Hapus",
    "cancel": "Batal",
    "close": "Tutup",
    "badge": "{n} hal baru. Membuka Aktivitas.",
    "opens": "Membuka Claude.",
    "back": "Kembali ke Claude",
    "hideLines": "Sembunyikan ucapannya",
    "showLines": "Tampilkan ucapannya"
  },
  "it": {
    "activity": "Attività",
    "activityMenu": "Attività…",
    "empty": "Ancora nulla.",
    "ready": "pronto",
    "finished": "finito",
    "placeholder": "Di’ qualcosa a Claude in {project}…",
    "send": "Invia",
    "sending": "Invio…",
    "unconfirmed": "Non so se è arrivato",
    "retry": "Riprova",
    "expired": "Tempo scaduto",
    "dictate": "Detta",
    "newChat": "Nuova chat",
    "confirmClear": "Cancellare questa conversazione in {project}?",
    "clear": "Cancella",
    "cancel": "Annulla",
    "close": "Chiudi",
    "badge": "{n} novità. Apre Attività.",
    "opens": "Apre Claude.",
    "back": "Torna a Claude",
    "hideLines": "Nascondi le sue battute",
    "showLines": "Mostra le sue battute"
  },
  "ko": {
    "activity": "활동",
    "activityMenu": "활동…",
    "empty": "아직 아무것도 없어.",
    "ready": "준비됨",
    "finished": "완료",
    "placeholder": "{project}의 Claude에게 말하기…",
    "send": "보내기",
    "sending": "보내는 중…",
    "unconfirmed": "도착했는지 모르겠어",
    "retry": "다시 시도",
    "expired": "시간 초과",
    "dictate": "받아쓰기",
    "newChat": "새 대화",
    "confirmClear": "{project}의 이 대화를 지울까?",
    "clear": "지우기",
    "cancel": "취소",
    "close": "닫기",
    "badge": "새 소식 {n}개. 활동을 엽니다.",
    "opens": "Claude를 엽니다.",
    "back": "Claude로 돌아가기",
    "hideLines": "대사 숨기기",
    "showLines": "대사 보이기"
  },
  "pt-BR": {
    "activity": "Atividade",
    "activityMenu": "Atividade…",
    "empty": "Nada ainda.",
    "ready": "pronto",
    "finished": "terminou",
    "placeholder": "Fale com Claude em {project}…",
    "send": "Enviar",
    "sending": "Enviando…",
    "unconfirmed": "Não sei se chegou",
    "retry": "Tentar de novo",
    "expired": "Tempo esgotado",
    "dictate": "Ditar",
    "newChat": "Nova conversa",
    "confirmClear": "Limpar esta conversa em {project}?",
    "clear": "Limpar",
    "cancel": "Cancelar",
    "close": "Fechar",
    "badge": "{n} novidades. Abre Atividade.",
    "opens": "Abre Claude.",
    "back": "Voltar ao Claude",
    "hideLines": "Esconder as falas dele",
    "showLines": "Mostrar as falas dele"
  },
  "es-419": {
    "activity": "Actividad",
    "activityMenu": "Actividad…",
    "empty": "Nada todavía.",
    "ready": "listo",
    "finished": "terminó",
    "placeholder": "Dile algo a Claude en {project}…",
    "send": "Enviar",
    "sending": "Enviando…",
    "unconfirmed": "No sé si llegó",
    "retry": "Reintentar",
    "expired": "Tiempo agotado",
    "dictate": "Dictar",
    "newChat": "Nueva conversación",
    "confirmClear": "¿Borrar esta conversación en {project}?",
    "clear": "Borrar",
    "cancel": "Cancelar",
    "close": "Cerrar",
    "badge": "{n} novedades. Abre Actividad.",
    "opens": "Abre Claude.",
    "back": "Volver a Claude",
    "hideLines": "Ocultar sus frases",
    "showLines": "Mostrar sus frases"
  },
  "es-ES": {
    "activity": "Actividad",
    "activityMenu": "Actividad…",
    "empty": "Aún nada.",
    "ready": "listo",
    "finished": "terminado",
    "placeholder": "Dile algo a Claude en {project}…",
    "send": "Enviar",
    "sending": "Enviando…",
    "unconfirmed": "No sé si llegó",
    "retry": "Reintentar",
    "expired": "Tiempo agotado",
    "dictate": "Dictar",
    "newChat": "Nueva conversación",
    "confirmClear": "¿Borrar esta conversación en {project}?",
    "clear": "Borrar",
    "cancel": "Cancelar",
    "close": "Cerrar",
    "badge": "{n} novedades. Abre Actividad.",
    "opens": "Abre Claude.",
    "back": "Volver a Claude",
    "hideLines": "Ocultar sus frases",
    "showLines": "Mostrar sus frases"
  }
}

const COMPANION_WORDS: Record<View['lang'], Omit<CompanionWords, 'context'>> = {
  en: {
    ...COMPANION_CARD_WORDS["en"],
    ...COMPANION_ACTIVITY_WORDS["en"],
    pat: 'pat his head', hide: 'Hide for an hour', home: 'Put him back', quit: 'Quit Claude-sama Companion',
    size: 'Size', tiny: 'Extra small', small: 'Small', medium: 'Medium', large: 'Large',
  },
  zh: {
    ...COMPANION_CARD_WORDS["zh"],
    ...COMPANION_ACTIVITY_WORDS["zh"],
    pat: '摸摸他的头', hide: '隐藏一小时', home: '放回原位', quit: '退出Claude-sama桌面伙伴',
    size: '大小', tiny: '最小', small: '小', medium: '中', large: '大',
  },
  ja: {
    ...COMPANION_CARD_WORDS["ja"],
    ...COMPANION_ACTIVITY_WORDS["ja"],
    pat: '頭をなでる', hide: '1時間隠す', home: '元の位置に戻す', quit: 'Claude-samaコンパニオンを終了',
    size: 'サイズ', tiny: '最小', small: '小', medium: '中', large: '大',
  },
  'fr': {
    ...COMPANION_CARD_WORDS["fr"],
    ...COMPANION_ACTIVITY_WORDS["fr"],
    pat: 'Caresser sa tête', hide: 'Masquer pendant une heure', home: 'Le remettre à sa place', quit: 'Quitter Claude-sama Companion',
    size: 'Taille', tiny: 'Très petit', small: 'Petit', medium: 'Moyen', large: 'Grand',
  },
  'de': {
    ...COMPANION_CARD_WORDS["de"],
    ...COMPANION_ACTIVITY_WORDS["de"],
    pat: 'Ihm über den Kopf streicheln', hide: 'Eine Stunde ausblenden', home: 'An seinen Platz zurücksetzen', quit: 'Claude-sama Companion beenden',
    size: 'Größe', tiny: 'Sehr klein', small: 'Klein', medium: 'Mittel', large: 'Groß',
  },
  'hi': {
    ...COMPANION_CARD_WORDS["hi"],
    ...COMPANION_ACTIVITY_WORDS["hi"],
    pat: 'उसके सिर पर हाथ फेरो', hide: 'एक घंटे के लिए छिपाओ', home: 'मूल जगह पर लौटाओ', quit: 'Claude-sama Companion बंद करो',
    size: 'आकार', tiny: 'सबसे छोटा', small: 'छोटा', medium: 'मध्यम', large: 'बड़ा',
  },
  'id': {
    ...COMPANION_CARD_WORDS["id"],
    ...COMPANION_ACTIVITY_WORDS["id"],
    pat: 'Elus kepalanya', hide: 'Sembunyikan selama satu jam', home: 'Kembalikan ke posisi semula', quit: 'Keluar dari Claude-sama Companion',
    size: 'Ukuran', tiny: 'Paling kecil', small: 'Kecil', medium: 'Sedang', large: 'Besar',
  },
  'it': {
    ...COMPANION_CARD_WORDS["it"],
    ...COMPANION_ACTIVITY_WORDS["it"],
    pat: 'Accarezzagli la testa', hide: 'Nascondi per un\'ora', home: 'Rimettilo al suo posto', quit: 'Esci da Claude-sama Companion',
    size: 'Dimensione', tiny: 'Piccolissimo', small: 'Piccolo', medium: 'Medio', large: 'Grande',
  },
  'ko': {
    ...COMPANION_CARD_WORDS["ko"],
    ...COMPANION_ACTIVITY_WORDS["ko"],
    pat: '머리 쓰다듬기', hide: '한 시간 숨기기', home: '원래 자리로 돌려놓기', quit: 'Claude-sama Companion 종료',
    size: '크기', tiny: '아주 작게', small: '작게', medium: '보통', large: '크게',
  },
  'pt-BR': {
    ...COMPANION_CARD_WORDS["pt-BR"],
    ...COMPANION_ACTIVITY_WORDS["pt-BR"],
    pat: 'Fazer carinho na cabeça dele', hide: 'Esconder por uma hora', home: 'Colocar de volta no lugar', quit: 'Fechar Claude-sama Companion',
    size: 'Tamanho', tiny: 'Mínimo', small: 'Pequeno', medium: 'Médio', large: 'Grande',
  },
  'es-419': {
    ...COMPANION_CARD_WORDS["es-419"],
    ...COMPANION_ACTIVITY_WORDS["es-419"],
    pat: 'Acariciarle la cabeza', hide: 'Ocultar por una hora', home: 'Devolverlo a su lugar', quit: 'Salir de Claude-sama Companion',
    size: 'Tamaño', tiny: 'Muy pequeño', small: 'Pequeño', medium: 'Mediano', large: 'Grande',
  },
  'es-ES': {
    ...COMPANION_CARD_WORDS["es-ES"],
    ...COMPANION_ACTIVITY_WORDS["es-ES"],
    pat: 'Acariciarle la cabeza', hide: 'Ocultar durante una hora', home: 'Devolverlo a su sitio', quit: 'Salir de Claude-sama Companion',
    size: 'Tamaño', tiny: 'Muy pequeño', small: 'Pequeño', medium: 'Mediano', large: 'Grande',
  },
}

/** What the companion draws from. `at`, `session` and `desktop` are added when it is written. */
export type CompanionRecord = CompanionRequest & CompanionActivity & {
  task: string | null
  mood: View['mood']
  /** The person's latest request to bring him back, in ms since 1970. */
  summon?: number
  /** The frame at rest: a loop's first frame, the open-eyed frame instead of a blink. */
  frame: Frame
  /** The mood's two-frame loop and its rate in ms, as the band runs it; null without one. */
  loop: readonly [Frame, Frame] | null
  every: number | null
  motion: typeof MOTION
  rest: boolean
  /** His line, or the omen slip's text while a slip is out. */
  said: string | null
  slip: boolean
  context: number | null
  estimate: boolean
  lang: View['lang']
  /** For VoiceOver: his name and the stage direction, in the session's language. */
  name: string
  aside: string
  words: CompanionWords
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

export function companionRecord(view: View): CompanionRecord {
  const loop = LOOPS[view.mood]
  const words = WORDS[view.lang] ?? WORDS.en
  return {
    ...activity,
    task: task === null ? null : TASK_WORDS[view.lang][task.key].replace(/\{(file|cmd|tool)\}/g, (_mark, key: 'file' | 'cmd' | 'tool') => task?.[key] ?? ''),
    mood: view.mood,
    ...(lastSummon === undefined ? {} : { summon: lastSummon }),
    ...lastRequests,
    frame: restingFrame(view),
    loop: loop ? loop.frames : null,
    every: loop ? loop.every : null,
    motion: MOTION,
    rest: RESTING.has(view.mood),
    said: view.slip ? view.slip.text : view.said,
    slip: view.slip !== null,
    context: view.context,
    estimate: view.estimate,
    lang: view.lang,
    name: words.name,
    aside: words.aside[view.mood] ?? '',
    words: { ...(COMPANION_WORDS[view.lang] ?? COMPANION_WORDS.en!), context: words.context },
    reactions: COMPANION_REACTIONS[view.lang] ?? COMPANION_REACTIONS.en!,
  }
}

/**
 * The record as compact JSON, without time or session: what push() compares with the last one
 * it wrote. Equal keys mean nothing the companion shows has changed, so nothing is written.
 */
export function companionKey(view: View): string {
  return JSON.stringify(companionRecord(view))
}

/** The file's whole text for a key from companionKey: version, session, desktop, time, record. */
export function companionText(key: string, session: string, desktop: boolean, at: number): string {
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
