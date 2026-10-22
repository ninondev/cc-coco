// Interface copy. Simplified Chinese is the approved source (docs/cards/DESIGN.md); the other twelve languages of the product
// (docs/cards/PRODUCT.md) are translated from it with English as a cross-check, each marked as not read by a native
// speaker except Traditional Chinese, which the owner reviewed line by line (2026-10-15). Coco's own lines were picked by the owner
// (2026-10-15) and keep their punctuation from persona/lines.json: ASCII commas, question and exclamation
// marks and parentheses in Chinese and Japanese.
import type { BookSort, Kind } from './model'
import type { Rarity } from './usage'

/** The thirteen tables. */
export const LANGS = ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es-ES', 'es-419', 'pt-BR', 'it', 'hi', 'id'] as const
export type Lang = (typeof LANGS)[number]
/** Three lines of Coco's for one place, said in turn. */
export type Said = readonly [string, string, string]

type Strings = {
  title: string
  /** Beside the button at the top of the bag (owner 10-19): how many cards the deck holds. */
  count: (n: number) => string
  unofficial: string
  notPlaced: string
  kind: Record<Kind | 'all', string>
  kindOne: Record<Kind, string>
  view: { box: string; book: string }
  motionOn: string
  motionOff: string
  search: string
  find: string
  clearSearch: string
  group: (g: string) => string
  uses: (n: number) => string
  /** Follows the use count of a card in the tray, its punctuation included. */
  inTray: string
  noDescription: string
  pullHint: string
  toNext: (uses: number, to: Rarity) => string
  top: string
  take: string
  untake: string
  putBack: string
  typeIt: string
  agentCall: string
  trayTitle: string
  /** The toast once a message went: the cards it took along. */
  carried: (names: readonly string[]) => string
  trayHint: string
  trayEmpty: string
  allBack: string
  remove: (name: string) => string
  empty: string
  emptyKind: string
  moreCards: (n: number) => string
  noMatch: (query: string) => string
  loading: string
  error: string
  retry: string
  /** Coco's three lines on their card in the box, and three in their pocket in the book; the pane says the next pair each time it opens. */
  cocoBox: Said
  cocoBook: Said
  cocoAlt: string
  /** A card's kind and group on one line. */
  meta: (kind: string, group: string) => string
  tally: (cards: number, sr: number, r: number, top: string | null) => string
  sortBy: Record<BookSort, string>
  sorted: Record<'uses' | 'name', string>
}

/**
 * Chinese names where a card comes from before what it is, with a space only after a Latin name: 个人Skill,
 * Claude Code 自带命令, MCP 命令 (owner, 2026-10-16).
 */
const groupFirst = (kind: string, group: string) => (/[\x21-\x7e]$/.test(group) ? `${group} ${kind}` : `${group}${kind}`)

const zh: Strings = {
  title: 'SKILL卡片',
  count: n => `已收 ${n} 张`,
  unofficial: '非官方同人作品，与 Anthropic 无关。',
  notPlaced: '这里放不下面板。',
  kind: { all: '全部', skill: 'Skill', agent: '子代理', command: '命令' },
  kindOne: { skill: 'Skill', agent: '子代理', command: '命令' },
  view: { box: '卡盒', book: '图鉴' },
  motionOn: '动画：开',
  motionOff: '动画：关',
  search: '按名字或说明找一张牌',
  find: '找',
  clearSearch: '清空搜索',
  group: g => (g === 'yours' ? '个人' : g === 'built-in' ? 'Claude Code 自带' : g === 'mcp' ? 'MCP' : g === 'other' ? '其他' : g.replace(/^plugin:/, '')),
  uses: n => `用过 ${n} 次`,
  inTray: '（在托盘里）',
  noDescription: '没写说明',
  pullHint: '点一张牌，把它从盒子里抽出来看。',
  toNext: (uses, to) => `再用 ${uses} 次升到 ${to}`,
  top: 'SR 是最高一级',
  take: '带上下一条消息',
  untake: '从下一条消息里拿出来',
  putBack: '放回盒子',
  typeIt: '写进输入框',
  agentCall: '由 Claude 派活给它',
  trayTitle: '下一条消息带上',
  carried: names => `这条消息带上了：${names.join('、')}`,
  trayHint: '发出去以后，这些牌自己回到盒子里。',
  trayEmpty: '还没放牌。抽一张，点「带上下一条消息」。',
  allBack: '全部放回',
  remove: name => `把 ${name} 放回盒子`,
  empty: '还没有牌。装好Skill、子代理或命令以后，它们会出现在这里。',
  emptyKind: '这一类还没有牌。',
  moreCards: n => `还有 ${n} 张牌放不下，搜一下就能找到。`,
  noMatch: q => `没找到「${q}」。换个词试试。`,
  loading: 'Coco 在数牌。',
  error: '读不到你的Skill列表：Claude Code 这次没把列表交给 Coco。',
  retry: '再读一次',
  cocoBox: ['想不起名字?翻翻看,我帮你记着呢', '用完会自动回盒,本天才管得严～', '(亮出蟹钳)别把我的牌角翻卷了哦!'],
  cocoBook: ['第一页当然归本天才坐镇,没意见吧?', '看使用次数,就晓得你平时偏心谁咯～', 'SR要一次次用出来,氪金没用喔～'],
  cocoAlt: 'Coco 扇开一手牌，抽出一张递给你',
  meta: groupFirst,
  tally: (cards, sr, r, top) => `${cards} 张牌，SR ${sr} 张，R ${r} 张。` + (top ? `用得最多的是 ${top}。` : ''),
  sortBy: { group: '按分类', uses: '按次数', name: '按名字' },
  sorted: { uses: '按用的次数', name: '按名字' },
}

const en: Strings = {
  title: 'SKILL cards',
  count: n => `${n} ${n === 1 ? 'card' : 'cards'}`,
  unofficial: 'Unofficial fan work, not affiliated with Anthropic.',
  notPlaced: 'There is no room for the pane here.',
  kind: { all: 'All', skill: 'Skills', agent: 'Subagents', command: 'Commands' },
  kindOne: { skill: 'Skill', agent: 'Subagent', command: 'Command' },
  view: { box: 'Box', book: 'Book' },
  motionOn: 'Motion: on',
  motionOff: 'Motion: off',
  search: 'Find a card by name or description',
  find: 'find',
  clearSearch: 'Clear search',
  group: g => (g === 'yours' ? 'Personal' : g === 'built-in' ? 'Built into Claude Code' : g === 'mcp' ? 'MCP' : g === 'other' ? 'Other' : g.replace(/^plugin:/, '')),
  uses: n => (n === 1 ? 'Used once' : `Used ${n} times`),
  inTray: ', in the tray',
  noDescription: 'No description',
  pullHint: 'Choose a card to pull it out of the box.',
  toNext: (uses, to) => (uses === 1 ? `One more use to ${to}` : `${uses} more uses to ${to}`),
  top: 'SR is the top level',
  take: 'Take into next message',
  untake: 'Take out of next message',
  putBack: 'Put back',
  typeIt: 'Write into the prompt',
  agentCall: 'Claude hands work to it',
  trayTitle: 'Going with the next message',
  carried: names => `With this message: ${names.join(', ')}`,
  trayHint: 'Once it is sent, these cards go back in the box by themselves.',
  trayEmpty: 'Nothing in the tray. Pull a card and choose “Take into next message”.',
  allBack: 'Put all back',
  remove: name => `Put ${name} back`,
  empty: 'No cards yet. Skills, subagents and commands appear here once they are installed.',
  emptyKind: 'No cards of this kind yet.',
  moreCards: n => (n === 1 ? 'One more card does not fit here; search to find it.' : `${n} more cards do not fit here; search to find them.`),
  noMatch: q => `Nothing matches “${q}”. Try another word.`,
  loading: 'Coco is counting the cards.',
  error: 'Could not read your skills: Claude Code did not hand the list to Coco this time.',
  retry: 'Try again',
  cocoBox: ['forgot a name? flip through, i remember~', 'one use, then back in the box. my rules~', '(claws out) don\'t bend my cards\' corners!'],
  cocoBook: ['page one is mine, obviously. objections?', 'your use counts give away your favorites~', 'SR is earned one use at a time. no pay-to-win~'],
  cocoAlt: 'Coco fans out a hand of cards and holds one out to you',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} ${cards === 1 ? 'card' : 'cards'}: ${sr} SR, ${r} R.` + (top ? ` Used most: ${top}.` : ''),
  sortBy: { group: 'By group', uses: 'By uses', name: 'By name' },
  sorted: { uses: 'By uses', name: 'By name' },
}


/** Names the groups: the person's own, Claude Code's built-ins and the rest, MCP as it is, a plugin by its name. */
const groupName = (names: { yours: string; builtIn: string; other: string }) => (g: string) =>
  g === 'yours' ? names.yours : g === 'built-in' ? names.builtIn : g === 'mcp' ? 'MCP' : g === 'other' ? names.other : g.replace(/^plugin:/, '')

// Taiwan's usage, converted from the Simplified table; reviewed line by line by the owner (2026-10-15).
const zhHant: Strings = {
  title: 'SKILL卡片',
  count: n => `已收 ${n} 張`,
  unofficial: '非官方同人作品，與 Anthropic 無關。',
  notPlaced: '這裡放不下面板。',
  kind: { all: '全部', skill: 'Skill', agent: '子代理', command: '指令' },
  kindOne: { skill: 'Skill', agent: '子代理', command: '指令' },
  view: { box: '卡盒', book: '圖鑑' },
  motionOn: '動畫：開',
  motionOff: '動畫：關',
  search: '依名稱或說明找一張牌',
  find: '找',
  clearSearch: '清除搜尋',
  group: groupName({ yours: '個人', builtIn: 'Claude Code 內建', other: '其他' }),
  uses: n => `用過 ${n} 次`,
  inTray: '（在托盤裡）',
  noDescription: '沒寫說明',
  pullHint: '點一張牌，把它從盒子裡抽出來看。',
  toNext: (uses, to) => `再用 ${uses} 次升到 ${to}`,
  top: 'SR 是最高一級',
  take: '帶上下一則訊息',
  untake: '從下一則訊息裡拿出來',
  putBack: '放回盒子',
  typeIt: '寫進輸入框',
  agentCall: '由 Claude 把工作交給它',
  trayTitle: '下一則訊息帶上',
  carried: names => `這則訊息帶上了：${names.join('、')}`,
  trayHint: '送出以後，這些牌會自己回到盒子裡。',
  trayEmpty: '還沒放牌。抽一張，點「帶上下一則訊息」。',
  allBack: '全部放回',
  remove: name => `把 ${name} 放回盒子`,
  empty: '還沒有牌。安裝Skill、子代理或指令以後，它們會出現在這裡。',
  emptyKind: '這一類還沒有牌。',
  moreCards: n => `還有 ${n} 張牌放不下，搜尋一下就能找到。`,
  noMatch: q => `沒找到「${q}」。換個詞試試。`,
  loading: 'Coco 在數牌。',
  error: '讀不到你的Skill清單：Claude Code 這次沒把清單交給 Coco。',
  retry: '再讀一次',
  cocoBox: ['想不起名字?翻翻看,我幫你記著呢', '用完會自動回盒,本天才管得嚴～', '(亮出蟹鉗)別把我的牌角翻捲了喔!'],
  cocoBook: ['第一頁當然歸本天才坐鎮,沒意見吧?', '看使用次數,就曉得你平常偏心誰囉～', 'SR要一次次用出來,課金沒用喔～'],
  cocoAlt: 'Coco 把一手牌扇開，抽出一張遞給你',
  meta: groupFirst,
  tally: (cards, sr, r, top) => `${cards} 張牌，SR ${sr} 張，R ${r} 張。` + (top ? `用得最多的是 ${top}。` : ''),
  sortBy: { group: '依分類', uses: '依次數', name: '依名稱' },
  sorted: { uses: '依使用次數', name: '依名稱' },
}

const ja: Strings = {
  title: 'SKILLカード',
  count: n => `${n} 枚`,
  unofficial: '非公式のファン作品です。Anthropic とは関係ありません。',
  notPlaced: 'ここにはパネルを置く場所がありません。',
  kind: { all: 'すべて', skill: 'Skill', agent: 'サブエージェント', command: 'コマンド' },
  kindOne: { skill: 'Skill', agent: 'サブエージェント', command: 'コマンド' },
  view: { box: 'カード箱', book: '図鑑' },
  motionOn: 'アニメーション：オン',
  motionOff: 'アニメーション：オフ',
  search: '名前か説明でカードを探す',
  find: '探す',
  clearSearch: '検索をクリア',
  group: groupName({ yours: '個人', builtIn: 'Claude Code 標準', other: 'その他' }),
  uses: n => `${n} 回使用`,
  inTray: '、トレイ内',
  noDescription: '説明なし',
  pullHint: 'カードを選ぶと、箱から抜き出して見られます。',
  toNext: (uses, to) => `あと ${uses} 回使うと ${to} に上がります`,
  top: 'SR が最高ランクです',
  take: '次のメッセージに付ける',
  untake: '次のメッセージから外す',
  putBack: '箱に戻す',
  typeIt: '入力欄に書き込む',
  agentCall: 'Claude が仕事を任せます',
  trayTitle: '次のメッセージと一緒に送る',
  carried: names => `このメッセージに付けたカード：${names.join('、')}`,
  trayHint: '送信すると、これらのカードはひとりでに箱へ戻ります。',
  trayEmpty: 'まだ何もありません。カードを抜いて「次のメッセージに付ける」を選んでください。',
  allBack: 'すべて戻す',
  remove: name => `${name} を箱に戻す`,
  empty: 'まだカードがありません。Skill、サブエージェント、コマンドをインストールすると、ここに並びます。',
  emptyKind: 'この種類のカードはまだありません。',
  moreCards: n => `ほかに ${n} 枚が入りきりません。検索すると見つかります。`,
  noMatch: q => `「${q}」に合うカードはありません。別の言葉で試してください。`,
  loading: 'Coco がカードを数えています。',
  error: 'Skill の一覧を読み込めませんでした。今回は Claude Code から Coco に一覧が渡されませんでした。',
  retry: 'もう一度読み込む',
  cocoBox: ['名前忘れた?めくってみて、ボクが覚えてる~', '一回使えば箱に戻る。ボクの管理は厳しいよ~', '(ハサミを構えて)ボクのカードの角、折らないでよ!'],
  cocoBook: ['1ページ目はもちろん天才のボクの席。文句ある?', '使った回数で、キミのお気に入りが丸わかり~', 'SRは使って育てるもの。課金じゃムリだよ~'],
  cocoAlt: 'Coco が手札を扇のように広げ、1 枚抜いて差し出している',
  meta: (kind, group) => `${kind}（${group}）`,
  tally: (cards, sr, r, top) => `${cards} 枚、SR ${sr} 枚、R ${r} 枚。` + (top ? `いちばん使っているのは ${top}。` : ''),
  sortBy: { group: '分類順', uses: '回数順', name: '名前順' },
  sorted: { uses: '使った回数順', name: '名前順' },
}

const ko: Strings = {
  title: 'SKILL 카드',
  count: n => `${n}장`,
  unofficial: '비공식 팬 작품이에요. Anthropic과는 관련이 없어요.',
  notPlaced: '여기에는 패널을 놓을 자리가 없어요.',
  kind: { all: '전체', skill: 'Skill', agent: '서브에이전트', command: '명령어' },
  kindOne: { skill: 'Skill', agent: '서브에이전트', command: '명령어' },
  view: { box: '카드 상자', book: '도감' },
  motionOn: '애니메이션: 켜짐',
  motionOff: '애니메이션: 꺼짐',
  search: '이름이나 설명으로 카드 찾기',
  find: '찾기',
  clearSearch: '검색어 지우기',
  group: groupName({ yours: '개인', builtIn: 'Claude Code 기본 제공', other: '기타' }),
  uses: n => `${n}번 사용`,
  inTray: ', 트레이에 있음',
  noDescription: '설명 없음',
  pullHint: '카드를 고르면 상자에서 꺼내 볼 수 있어요.',
  toNext: (uses, to) => `${uses}번 더 쓰면 ${to}로 올라가요`,
  top: 'SR이 가장 높은 등급이에요',
  take: '다음 메시지에 담기',
  untake: '다음 메시지에서 빼기',
  putBack: '상자에 다시 넣기',
  typeIt: '입력창에 쓰기',
  agentCall: 'Claude가 일을 맡겨요',
  trayTitle: '다음 메시지와 함께 보낼 카드',
  carried: names => `이 메시지에 담은 카드: ${names.join(', ')}`,
  trayHint: '보내고 나면 이 카드들은 저절로 상자로 돌아가요.',
  trayEmpty: '아직 담은 카드가 없어요. 카드를 꺼내서 ‘다음 메시지에 담기’를 누르세요.',
  allBack: '모두 다시 넣기',
  remove: name => `${name} 다시 넣기`,
  empty: '아직 카드가 없어요. Skill, 서브에이전트, 명령어를 설치하면 여기에 나타나요.',
  emptyKind: '이 종류의 카드는 아직 없어요.',
  moreCards: n => `카드 ${n}장이 더 있지만 여기에 다 들어가지 않아요. 검색하면 찾을 수 있어요.`,
  noMatch: q => `‘${q}’에 맞는 카드가 없어요. 다른 말로 찾아보세요.`,
  loading: 'Coco가 카드를 세고 있어요.',
  error: 'Skill 목록을 읽지 못했어요. 이번에는 Claude Code가 Coco에게 목록을 넘겨주지 않았어요.',
  retry: '다시 읽기',
  cocoBox: ['이름이 기억 안 나? 넘겨 봐, 내가 기억해~', '한 번 쓰면 상자로 쏙. 관리는 이 천재가 빡세게~', '(집게 번쩍) 내 카드 모서리 접지 마!'],
  cocoBook: ['첫 페이지는 당연히 이 천재 자리. 불만 있어?', '사용 횟수만 보면 네 최애가 딱 보여~', 'SR은 써서 키우는 거야. 현질은 안 통해~'],
  cocoAlt: 'Coco가 카드를 부채꼴로 펼쳐 한 장을 건네는 모습',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `카드 ${cards}장, SR ${sr}장, R ${r}장.` + (top ? ` 가장 많이 쓴 카드: ${top}.` : ''),
  sortBy: { group: '분류순', uses: '사용 횟수순', name: '이름순' },
  sorted: { uses: '사용 횟수순', name: '이름순' },
}

// French spacing: a no-break space before : ; and inside « ».
const fr: Strings = {
  title: 'Cartes SKILL',
  count: n => `${n} ${n <= 1 ? 'carte' : 'cartes'}`,
  unofficial: 'Œuvre de fan non officielle, sans lien avec Anthropic.',
  notPlaced: 'Il n’y a pas de place ici pour le panneau.',
  kind: { all: 'Toutes', skill: 'Skills', agent: 'Sous-agents', command: 'Commandes' },
  kindOne: { skill: 'Skill', agent: 'Sous-agent', command: 'Commande' },
  view: { box: 'Boîte', book: 'Album' },
  motionOn: 'Animation : activée',
  motionOff: 'Animation : désactivée',
  search: 'Chercher une carte par nom ou description',
  find: 'chercher',
  clearSearch: 'Effacer la recherche',
  group: groupName({ yours: 'Personnelles', builtIn: 'Intégrées à Claude Code', other: 'Autres' }),
  uses: n => (n <= 1 ? `${n} utilisation` : `${n} utilisations`),
  inTray: ', dans le plateau',
  noDescription: 'Pas de description',
  pullHint: 'Choisissez une carte pour la sortir de la boîte.',
  toNext: (uses, to) => (uses <= 1 ? `Encore ${uses} utilisation pour passer ${to}` : `Encore ${uses} utilisations pour passer ${to}`),
  top: 'SR est le niveau le plus haut',
  take: 'Joindre au prochain message',
  untake: 'Retirer du prochain message',
  putBack: 'Remettre dans la boîte',
  typeIt: 'Écrire dans la zone de saisie',
  agentCall: 'Claude lui confie du travail',
  trayTitle: 'Part avec le prochain message',
  carried: names => `Avec ce message\u00a0: ${names.join(', ')}`,
  trayHint: 'Une fois le message envoyé, ces cartes retournent d’elles-mêmes dans la boîte.',
  trayEmpty: 'Le plateau est vide. Sortez une carte et choisissez « Joindre au prochain message ».',
  allBack: 'Tout remettre',
  remove: name => `Remettre ${name} dans la boîte`,
  empty: 'Pas encore de cartes. Les skills, sous-agents et commandes apparaissent ici une fois installés.',
  emptyKind: 'Pas encore de cartes de ce type.',
  moreCards: n => (n === 1 ? 'Une carte de plus ne tient pas ici ; la recherche la retrouve.' : `${n} cartes de plus ne tiennent pas ici ; la recherche les retrouve.`),
  noMatch: q => `Rien ne correspond à « ${q} ». Essayez un autre mot.`,
  loading: 'Coco compte les cartes.',
  error: 'Impossible de lire vos skills : cette fois, Claude Code n’a pas transmis la liste à Coco.',
  retry: 'Réessayer',
  cocoBox: ['un nom t’échappe\u00a0? feuillette, moi je m’en souviens~', 'une fois servie, retour dans la boîte. j’y veille~', '(pinces dehors) me corne pas mes cartes\u00a0!'],
  cocoBook: ['la page une, c’est à moi. des objections\u00a0?', 'tes compteurs trahissent tes chouchous~', 'le SR se gagne à l’usage. pas de pay-to-win~'],
  cocoAlt: 'Coco déploie ses cartes en éventail et vous en tend une',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} ${cards <= 1 ? 'carte' : 'cartes'} : ${sr} SR, ${r} R.` + (top ? ` La plus utilisée : ${top}.` : ''),
  sortBy: { group: 'Par groupe', uses: 'Par utilisations', name: 'Par nom' },
  sorted: { uses: 'Par utilisations', name: 'Par nom' },
}

const de: Strings = {
  title: 'SKILL-Karten',
  count: n => `${n} ${n === 1 ? 'Karte' : 'Karten'}`,
  unofficial: 'Inoffizielles Fanwerk, nicht mit Anthropic verbunden.',
  notPlaced: 'Hier ist kein Platz für das Panel.',
  kind: { all: 'Alle', skill: 'Skills', agent: 'Subagents', command: 'Befehle' },
  kindOne: { skill: 'Skill', agent: 'Subagent', command: 'Befehl' },
  view: { box: 'Kartenbox', book: 'Album' },
  motionOn: 'Animation: an',
  motionOff: 'Animation: aus',
  search: 'Karte nach Name oder Beschreibung suchen',
  find: 'suchen',
  clearSearch: 'Suche leeren',
  group: groupName({ yours: 'Persönlich', builtIn: 'In Claude Code enthalten', other: 'Sonstige' }),
  uses: n => (n === 1 ? 'Einmal genutzt' : `${n}-mal genutzt`),
  inTray: ', in der Ablage',
  noDescription: 'Keine Beschreibung',
  pullHint: 'Wähle eine Karte, um sie aus der Box zu ziehen.',
  toNext: (uses, to) => (uses === 1 ? `Noch 1 Nutzung bis ${to}` : `Noch ${uses} Nutzungen bis ${to}`),
  top: 'SR ist die höchste Stufe',
  take: 'Der nächsten Nachricht beilegen',
  untake: 'Aus der nächsten Nachricht nehmen',
  putBack: 'Zurück in die Box',
  typeIt: 'Ins Eingabefeld schreiben',
  agentCall: 'Claude gibt ihm Aufgaben',
  trayTitle: 'Geht mit der nächsten Nachricht mit',
  carried: names => `Dieser Nachricht beigelegt: ${names.join(', ')}`,
  trayHint: 'Nach dem Senden wandern diese Karten von selbst zurück in die Box.',
  trayEmpty: 'Die Ablage ist leer. Zieh eine Karte und wähle „Der nächsten Nachricht beilegen“.',
  allBack: 'Alle zurücklegen',
  remove: name => `${name} zurücklegen`,
  empty: 'Noch keine Karten. Skills, Subagents und Befehle erscheinen hier, sobald sie installiert sind.',
  emptyKind: 'Von dieser Art gibt es noch keine Karten.',
  moreCards: n => (n === 1 ? 'Eine weitere Karte passt nicht hierher; die Suche findet sie.' : `${n} weitere Karten passen nicht hierher; die Suche findet sie.`),
  noMatch: q => `Nichts passt zu „${q}“. Versuch es mit einem anderen Wort.`,
  loading: 'Coco zählt die Karten.',
  error: 'Deine Skills ließen sich nicht lesen: Claude Code hat Coco die Liste diesmal nicht übergeben.',
  retry: 'Noch einmal versuchen',
  cocoBox: ['Name vergessen? Blätter mal, ich merk’s mir~', 'Einmal benutzt, zurück in die Box. Meine Regeln~', '(Scheren raus) Knick mir ja keine Kartenecken!'],
  cocoBook: ['Seite eins gehört natürlich mir. Einwände?', 'Deine Zähler verraten deine Lieblinge~', 'SR gibt’s nur durchs Benutzen. Kein Pay-to-win~'],
  cocoAlt: 'Coco fächert ihre Karten auf und reicht dir eine',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} ${cards === 1 ? 'Karte' : 'Karten'}: ${sr} SR, ${r} R.` + (top ? ` Am meisten genutzt: ${top}.` : ''),
  sortBy: { group: 'Nach Gruppe', uses: 'Nach Nutzung', name: 'Nach Name' },
  sorted: { uses: 'Nach Nutzung', name: 'Nach Name' },
}

// Spain: «» quotes, the present perfect for what just happened.
const esES: Strings = {
  title: 'Cartas SKILL',
  count: n => `${n} ${n === 1 ? 'carta' : 'cartas'}`,
  unofficial: 'Obra de fans no oficial, sin relación con Anthropic.',
  notPlaced: 'Aquí no cabe el panel.',
  kind: { all: 'Todas', skill: 'Skills', agent: 'Subagentes', command: 'Comandos' },
  kindOne: { skill: 'Skill', agent: 'Subagente', command: 'Comando' },
  view: { box: 'Caja', book: 'Álbum' },
  motionOn: 'Animación: activada',
  motionOff: 'Animación: desactivada',
  search: 'Busca una carta por nombre o descripción',
  find: 'buscar',
  clearSearch: 'Borrar la búsqueda',
  group: groupName({ yours: 'Personales', builtIn: 'Incluidas en Claude Code', other: 'Otras' }),
  uses: n => (n === 1 ? '1 uso' : `${n} usos`),
  inTray: ', en la bandeja',
  noDescription: 'Sin descripción',
  pullHint: 'Elige una carta para sacarla de la caja.',
  toNext: (uses, to) => (uses === 1 ? `1 uso más para subir a ${to}` : `${uses} usos más para subir a ${to}`),
  top: 'SR es el nivel más alto',
  take: 'Adjuntar al siguiente mensaje',
  untake: 'Quitar del siguiente mensaje',
  putBack: 'Devolver a la caja',
  typeIt: 'Escribir en el cuadro de texto',
  agentCall: 'Claude le encarga trabajo',
  trayTitle: 'Va con el siguiente mensaje',
  carried: names => `Con este mensaje: ${names.join(', ')}`,
  trayHint: 'Al enviarlo, estas cartas vuelven solas a la caja.',
  trayEmpty: 'La bandeja está vacía. Saca una carta y elige «Adjuntar al siguiente mensaje».',
  allBack: 'Devolver todas',
  remove: name => `Devolver ${name} a la caja`,
  empty: 'Aún no hay cartas. Las skills, los subagentes y los comandos aparecen aquí cuando se instalan.',
  emptyKind: 'Aún no hay cartas de este tipo.',
  moreCards: n => (n === 1 ? 'Hay 1 carta más que no cabe aquí; búscala para encontrarla.' : `Hay ${n} cartas más que no caben aquí; búscalas para encontrarlas.`),
  noMatch: q => `Nada coincide con «${q}». Prueba con otra palabra.`,
  loading: 'Coco está contando las cartas.',
  error: 'No se han podido leer tus skills: esta vez Claude Code no le ha pasado la lista a Coco.',
  retry: 'Reintentar',
  cocoBox: ['¿se te ha ido el nombre? ojea, yo me acuerdo~', 'usada una vez, vuelve a la caja. aquí mando yo~', '(pinzas fuera) ¡no me dobles las esquinas!'],
  cocoBook: ['la página uno es mía, claro. ¿alguna queja?', 'tus contadores delatan a tus favoritas~', 'el SR se gana con el uso. nada de pagar para ganar~'],
  cocoAlt: 'Coco abre sus cartas en abanico y te ofrece una',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} ${cards === 1 ? 'carta' : 'cartas'}: ${sr} SR, ${r} R.` + (top ? ` La más usada: ${top}.` : ''),
  sortBy: { group: 'Por grupo', uses: 'Por usos', name: 'Por nombre' },
  sorted: { uses: 'Por usos', name: 'Por nombre' },
}

// Latin America: “” quotes, the simple past, próximo for next.
const es419: Strings = {
  ...esES,
  clearSearch: 'Borrar búsqueda',
  take: 'Adjuntar al próximo mensaje',
  untake: 'Quitar del próximo mensaje',
  typeIt: 'Escribir en el campo de texto',
  trayTitle: 'Va con el próximo mensaje',
  trayEmpty: 'La bandeja está vacía. Saca una carta y elige “Adjuntar al próximo mensaje”.',
  empty: 'Todavía no hay cartas. Las skills, los subagentes y los comandos aparecen aquí cuando se instalan.',
  emptyKind: 'Todavía no hay cartas de este tipo.',
  noMatch: q => `Nada coincide con “${q}”. Prueba con otra palabra.`,
  error: 'No se pudieron leer tus skills: esta vez Claude Code no le pasó la lista a Coco.',
  retry: 'Volver a intentar',
  cocoBox: ['¿se te fue el nombre? hojea, yo me acuerdo~', 'usada una vez, vuelve a la caja. aquí mando yo~', '(pinzas afuera) ¡no me dobles las esquinas!'],
  cocoBook: ['la página uno es mía, obvio. ¿alguna queja?', 'tus contadores delatan a tus favoritas~', 'el SR se gana con el uso. nada de pay-to-win~'],
}

const ptBR: Strings = {
  title: 'Cartas SKILL',
  count: n => `${n} ${n === 1 ? 'carta' : 'cartas'}`,
  unofficial: 'Obra de fã não oficial, sem vínculo com a Anthropic.',
  notPlaced: 'Não há espaço para o painel aqui.',
  kind: { all: 'Todas', skill: 'Skills', agent: 'Subagentes', command: 'Comandos' },
  kindOne: { skill: 'Skill', agent: 'Subagente', command: 'Comando' },
  view: { box: 'Caixa', book: 'Álbum' },
  motionOn: 'Animação: ligada',
  motionOff: 'Animação: desligada',
  search: 'Encontre uma carta pelo nome ou pela descrição',
  find: 'buscar',
  clearSearch: 'Limpar busca',
  group: groupName({ yours: 'Pessoais', builtIn: 'Incluídas no Claude Code', other: 'Outras' }),
  uses: n => (n === 1 ? '1 uso' : `${n} usos`),
  inTray: ', na bandeja',
  noDescription: 'Sem descrição',
  pullHint: 'Escolha uma carta para tirá-la da caixa.',
  toNext: (uses, to) => (uses === 1 ? `Mais 1 uso para chegar a ${to}` : `Mais ${uses} usos para chegar a ${to}`),
  top: 'SR é o nível mais alto',
  take: 'Anexar à próxima mensagem',
  untake: 'Tirar da próxima mensagem',
  putBack: 'Devolver à caixa',
  typeIt: 'Escrever no campo de texto',
  agentCall: 'O Claude passa trabalho para ele',
  trayTitle: 'Vai com a próxima mensagem',
  carried: names => `Com esta mensagem: ${names.join(', ')}`,
  trayHint: 'Depois do envio, estas cartas voltam sozinhas para a caixa.',
  trayEmpty: 'A bandeja está vazia. Tire uma carta e escolha “Anexar à próxima mensagem”.',
  allBack: 'Devolver todas',
  remove: name => `Devolver ${name} à caixa`,
  empty: 'Ainda não há cartas. Skills, subagentes e comandos aparecem aqui depois de instalados.',
  emptyKind: 'Ainda não há cartas deste tipo.',
  moreCards: n => (n === 1 ? 'Mais 1 carta não cabe aqui; use a busca para encontrá-la.' : `Mais ${n} cartas não cabem aqui; use a busca para encontrá-las.`),
  noMatch: q => `Nada corresponde a “${q}”. Tente outra palavra.`,
  loading: 'A Coco está contando as cartas.',
  error: 'Não foi possível ler suas skills: desta vez o Claude Code não passou a lista para a Coco.',
  retry: 'Tentar de novo',
  cocoBox: ['esqueceu o nome? folheia, eu lembro~', 'usou uma vez, volta pra caixa. regra minha~', '(pinças à mostra) não dobra minhas cartas!'],
  cocoBook: ['a página um é minha, óbvio. alguma objeção?', 'seus contadores entregam suas favoritas~', 'SR se conquista no uso. nada de pay-to-win~'],
  cocoAlt: 'Coco abre as cartas em leque e oferece uma a você',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} ${cards === 1 ? 'carta' : 'cartas'}: ${sr} SR, ${r} R.` + (top ? ` A mais usada: ${top}.` : ''),
  sortBy: { group: 'Por grupo', uses: 'Por usos', name: 'Por nome' },
  sorted: { uses: 'Por usos', name: 'Por nome' },
}

const it: Strings = {
  title: 'Carte SKILL',
  count: n => `${n} ${n === 1 ? 'carta' : 'carte'}`,
  unofficial: 'Opera di fan non ufficiale, non affiliata ad Anthropic.',
  notPlaced: 'Qui non c’è spazio per il pannello.',
  kind: { all: 'Tutte', skill: 'Skill', agent: 'Subagenti', command: 'Comandi' },
  kindOne: { skill: 'Skill', agent: 'Subagente', command: 'Comando' },
  view: { box: 'Scatola', book: 'Album' },
  motionOn: 'Animazione: attiva',
  motionOff: 'Animazione: disattivata',
  search: 'Cerca una carta per nome o descrizione',
  find: 'cerca',
  clearSearch: 'Cancella la ricerca',
  group: groupName({ yours: 'Personali', builtIn: 'Incluse in Claude Code', other: 'Altre' }),
  uses: n => (n === 1 ? '1 uso' : `${n} usi`),
  inTray: ', nel vassoio',
  noDescription: 'Nessuna descrizione',
  pullHint: 'Scegli una carta per tirarla fuori dalla scatola.',
  toNext: (uses, to) => (uses === 1 ? `Ancora 1 uso per salire a ${to}` : `Ancora ${uses} usi per salire a ${to}`),
  top: 'SR è il livello più alto',
  take: 'Allega al prossimo messaggio',
  untake: 'Togli dal prossimo messaggio',
  putBack: 'Rimetti nella scatola',
  typeIt: 'Scrivi nel campo di testo',
  agentCall: 'Claude gli affida il lavoro',
  trayTitle: 'Va con il prossimo messaggio',
  carried: names => `Con questo messaggio: ${names.join(', ')}`,
  trayHint: 'Dopo l’invio, queste carte tornano da sole nella scatola.',
  trayEmpty: 'Il vassoio è vuoto. Estrai una carta e scegli «Allega al prossimo messaggio».',
  allBack: 'Rimetti tutte',
  remove: name => `Rimetti ${name} nella scatola`,
  empty: 'Ancora nessuna carta. Skill, subagenti e comandi compaiono qui una volta installati.',
  emptyKind: 'Ancora nessuna carta di questo tipo.',
  moreCards: n => (n === 1 ? 'Un’altra carta non ci sta qui; cercala per trovarla.' : `Altre ${n} carte non ci stanno qui; cercale per trovarle.`),
  noMatch: q => `Nessuna carta corrisponde a «${q}». Prova con un’altra parola.`,
  loading: 'Coco sta contando le carte.',
  error: 'Impossibile leggere le tue skill: questa volta Claude Code non ha passato l’elenco a Coco.',
  retry: 'Riprova',
  cocoBox: ['un nome ti sfugge? sfoglia, me lo ricordo io~', 'usata una volta, torna nella scatola. regole mie~', '(chele pronte) guai a piegarmi le carte!'],
  cocoBook: ['la pagina uno è mia, ovvio. obiezioni?', 'i contatori svelano le tue preferite~', 'l’SR si guadagna usando. niente pay-to-win~'],
  cocoAlt: 'Coco apre le carte a ventaglio e te ne porge una',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} ${cards === 1 ? 'carta' : 'carte'}: ${sr} SR, ${r} R.` + (top ? ` La più usata: ${top}.` : ''),
  sortBy: { group: 'Per gruppo', uses: 'Per usi', name: 'Per nome' },
  sorted: { uses: 'Per usi', name: 'Per nome' },
}

const hi: Strings = {
  title: 'SKILL कार्ड',
  count: n => `${n} कार्ड`,
  unofficial: 'गैर-आधिकारिक फ़ैन रचना, Anthropic से इसका कोई संबंध नहीं है।',
  notPlaced: 'यहाँ पैनल के लिए जगह नहीं है।',
  kind: { all: 'सभी', skill: 'Skill', agent: 'सबएजेंट', command: 'कमांड' },
  kindOne: { skill: 'Skill', agent: 'सबएजेंट', command: 'कमांड' },
  view: { box: 'डिब्बा', book: 'एल्बम' },
  motionOn: 'एनिमेशन: चालू',
  motionOff: 'एनिमेशन: बंद',
  search: 'नाम या विवरण से कार्ड खोजें',
  find: 'खोजें',
  clearSearch: 'खोज साफ़ करें',
  group: groupName({ yours: 'निजी', builtIn: 'Claude Code में शामिल', other: 'अन्य' }),
  uses: n => `${n} बार इस्तेमाल`,
  inTray: ', ट्रे में',
  noDescription: 'कोई विवरण नहीं',
  pullHint: 'किसी कार्ड को चुनें और उसे डिब्बे से निकालकर देखें।',
  toNext: (uses, to) => `${to} तक पहुँचने के लिए ${uses} बार और इस्तेमाल करें`,
  top: 'SR सबसे ऊँचा स्तर है',
  take: 'अगले संदेश के साथ भेजें',
  untake: 'अगले संदेश से हटाएँ',
  putBack: 'डिब्बे में वापस रखें',
  typeIt: 'इनपुट बॉक्स में लिखें',
  agentCall: 'Claude इसे काम सौंपता है',
  trayTitle: 'अगले संदेश के साथ जाएँगे',
  carried: names => `इस संदेश के साथ: ${names.join(', ')}`,
  trayHint: 'संदेश भेजने के बाद ये कार्ड अपने-आप डिब्बे में लौट जाते हैं।',
  trayEmpty: 'ट्रे खाली है। कोई कार्ड निकालें और “अगले संदेश के साथ भेजें” चुनें।',
  allBack: 'सब वापस रखें',
  remove: name => `${name} को डिब्बे में वापस रखें`,
  empty: 'अभी कोई कार्ड नहीं है। Skill, सबएजेंट या कमांड इंस्टॉल होने पर यहाँ दिखेंगे।',
  emptyKind: 'इस तरह का अभी कोई कार्ड नहीं है।',
  moreCards: n => (n === 1 ? '1 और कार्ड यहाँ नहीं समा रहा; खोजकर उसे ढूँढ़ें।' : `${n} और कार्ड यहाँ नहीं समा रहे; खोजकर उन्हें ढूँढ़ें।`),
  noMatch: q => `“${q}” से मेल खाता कुछ नहीं मिला। कोई और शब्द आज़माएँ।`,
  loading: 'Coco कार्ड गिन रही है।',
  error: 'आपकी Skill की सूची नहीं पढ़ी जा सकी: इस बार Claude Code ने सूची Coco को नहीं दी।',
  retry: 'फिर से कोशिश करें',
  cocoBox: ['नाम याद नहीं? पलटकर देखो, मुझे याद है~', 'एक बार इस्तेमाल, फिर वापस डिब्बे में। नियम मेरे~', '(पंजे तैयार) मेरे कार्ड के कोने मत मोड़ना!'],
  cocoBook: ['पहला पन्ना तो मेरा है, ज़ाहिर है। कोई शिकायत?', 'गिनती बता देती है तुम्हारे favourite कौन हैं~', 'SR इस्तेमाल से मिलता है, खरीदने से नहीं~'],
  cocoAlt: 'Coco कार्डों को पंखे की तरह फैलाकर एक कार्ड आपकी ओर बढ़ा रही है',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} कार्ड: SR ${sr}, R ${r}।` + (top ? ` सबसे ज़्यादा इस्तेमाल: ${top}।` : ''),
  sortBy: { group: 'समूह के अनुसार', uses: 'इस्तेमाल के अनुसार', name: 'नाम के अनुसार' },
  sorted: { uses: 'इस्तेमाल के अनुसार', name: 'नाम के अनुसार' },
}

const id: Strings = {
  title: 'Kartu SKILL',
  count: n => `${n} kartu`,
  unofficial: 'Karya penggemar tidak resmi, tidak berafiliasi dengan Anthropic.',
  notPlaced: 'Tidak ada tempat untuk panel di sini.',
  kind: { all: 'Semua', skill: 'Skill', agent: 'Subagen', command: 'Perintah' },
  kindOne: { skill: 'Skill', agent: 'Subagen', command: 'Perintah' },
  view: { box: 'Kotak', book: 'Album' },
  motionOn: 'Animasi: aktif',
  motionOff: 'Animasi: nonaktif',
  search: 'Cari kartu menurut nama atau deskripsi',
  find: 'cari',
  clearSearch: 'Hapus pencarian',
  group: groupName({ yours: 'Pribadi', builtIn: 'Bawaan Claude Code', other: 'Lainnya' }),
  uses: n => `Dipakai ${n} kali`,
  inTray: ', di baki',
  noDescription: 'Tanpa deskripsi',
  pullHint: 'Pilih kartu untuk menariknya keluar dari kotak.',
  toNext: (uses, to) => `${uses} kali lagi untuk naik ke ${to}`,
  top: 'SR adalah tingkat tertinggi',
  take: 'Sertakan di pesan berikutnya',
  untake: 'Keluarkan dari pesan berikutnya',
  putBack: 'Kembalikan ke kotak',
  typeIt: 'Tulis ke kolom input',
  agentCall: 'Claude memberinya tugas',
  trayTitle: 'Ikut pesan berikutnya',
  carried: names => `Ikut pesan ini: ${names.join(', ')}`,
  trayHint: 'Setelah pesan terkirim, kartu-kartu ini kembali sendiri ke kotak.',
  trayEmpty: 'Baki masih kosong. Tarik kartu, lalu pilih “Sertakan di pesan berikutnya”.',
  allBack: 'Kembalikan semua',
  remove: name => `Kembalikan ${name} ke kotak`,
  empty: 'Belum ada kartu. Skill, subagen, dan perintah akan muncul di sini setelah dipasang.',
  emptyKind: 'Belum ada kartu jenis ini.',
  moreCards: n => `Masih ada ${n} kartu yang tidak muat di sini; cari untuk menemukannya.`,
  noMatch: q => `Tidak ada yang cocok dengan “${q}”. Coba kata lain.`,
  loading: 'Coco sedang menghitung kartu.',
  error: 'Skill Anda tidak bisa dibaca: kali ini Claude Code tidak menyerahkan daftarnya ke Coco.',
  retry: 'Coba lagi',
  cocoBox: ['lupa namanya? bolak-balik aja, aku yang ingat~', 'sekali pakai, balik ke kotak. aturanku ketat~', '(capit siaga) jangan lipat ujung kartuku!'],
  cocoBook: ['halaman satu jelas punyaku. ada yang protes?', 'dari jumlah pakai, ketahuan favoritmu~', 'SR cuma dari dipakai. nggak bisa dibeli~'],
  cocoAlt: 'Coco membuka kartunya seperti kipas dan menyodorkan satu kepada Anda',
  meta: (kind, group) => `${kind} (${group})`,
  tally: (cards, sr, r, top) => `${cards} kartu: ${sr} SR, ${r} R.` + (top ? ` Paling sering dipakai: ${top}.` : ''),
  sortBy: { group: 'Menurut grup', uses: 'Menurut pemakaian', name: 'Menurut nama' },
  sorted: { uses: 'Menurut pemakaian', name: 'Menurut nama' },
}

export const STRINGS: Record<Lang, Strings> = {
  'zh-Hans': zh,
  'zh-Hant': zhHant,
  en,
  ja,
  ko,
  fr,
  de,
  'es-ES': esES,
  'es-419': es419,
  'pt-BR': ptBR,
  it,
  hi,
  id,
}

/**
 * The table for a locale tag (`zh-TW`, `zh-Hant-HK`, `es-MX`, `pt_PT.UTF-8`), or undefined when its language has
 * none. Chinese goes by script, then by region; Spanish of Spain or of no region is es-ES, any other es-419; every
 * Portuguese is pt-BR.
 */
export function tableOf(tag: string): Lang | undefined {
  const [base = '', ...rest] = tag.trim().replace(/[.@].*$/, '').replace(/_/g, '-').toLowerCase().split('-')
  switch (base) {
    case 'zh':
      if (rest.includes('hans')) return 'zh-Hans'
      return rest.some(t => t === 'hant' || t === 'tw' || t === 'hk' || t === 'mo') ? 'zh-Hant' : 'zh-Hans'
    case 'es': {
      const region = rest.find(t => /^([a-z]{2}|\d{3})$/.test(t))
      return region === undefined || region === 'es' ? 'es-ES' : 'es-419'
    }
    case 'pt':
      return 'pt-BR'
    case 'en':
    case 'ja':
    case 'ko':
    case 'fr':
    case 'de':
    case 'it':
    case 'hi':
    case 'id':
      return base
    default:
      return undefined
  }
}

/** Names in a row the way the language lists them: 、 in Chinese and Japanese, a comma elsewhere. */
export function listOf(lang: Lang, names: readonly string[]): string {
  return names.join(lang === 'zh-Hans' || lang === 'zh-Hant' || lang === 'ja' ? '、' : ', ')
}

/** Picks the table for a locale tag; a language without one gets English. */
export function langOf(tag: string | undefined): Lang {
  return (tag && tableOf(tag)) || 'en'
}
