import type { ConfigDescribeInput, ConfigDescribeResult } from 'claude-code'
import type { Lang } from './words'

type ConfigWords = { band: { label: string; description: string }; language: { label: string; description: string } }
// zh, en and ja are the approved words-0.1.2 rows; other locales use plain interface language.
export const CONFIG_WORDS: Record<Lang, ConfigWords> = {
 en: { band: { label: 'Coco above the prompt', description: "on: Coco's band with pictures. compact: one line. off: put away, with a small door to call Coco back." }, language: { label: "Coco's language", description: "auto: follows Claude Code's language setting, otherwise your system's." } },
 zh: { band: { label: '输入框上方的小克', description: 'on：带画的横条；compact：只留一行；off：收起来，留一扇小门叫她回来。' }, language: { label: '小克的语言', description: 'auto：跟着 Claude Code 的语言设置，没设就跟系统。' } },
 // BEGIN generated zh-Hant /CONFIG_WORDS/zh; OpenCC 0.1.7; s2twp
 "zh-Hant": { band: { label: "輸入框上方的小克", description: "on：帶畫的橫條；compact：只留一行；off：收起來，留一扇小門叫她回來。" }, language: { label: "小克的語言", description: "auto：跟著 Claude Code 的語言設定，沒設就跟系統。" } },
 // END generated zh-Hant

 ja: { band: { label: '入力欄の上のCoco', description: 'on：絵つきの帯。compact：一行だけ。off：しまって、呼び戻す小さな扉だけ残します。' }, language: { label: 'Cocoの言葉', description: 'auto：Claude Code の言語設定に合わせ、なければシステムの言語に。' } },
 fr: { band: { label: 'Coco au-dessus de la saisie', description: 'on : son bandeau illustré. compact : une seule ligne. off : le ranger, avec une petite porte pour la rappeler.' }, language: { label: 'Langue de Coco', description: 'auto : suit la langue de Claude Code, ou celle du système si elle n’est pas définie.' } },
 de: { band: { label: 'Coco über dem Eingabefeld', description: 'on: ihre Leiste mit Bildern. compact: eine Zeile. off: einklappen, mit einer kleinen Tür, um sie zurückzurufen.' }, language: { label: 'Sprache von Coco', description: 'auto: folgt der Spracheinstellung von Claude Code, sonst der Systemsprache.' } },
 hi: { band: { label: 'इनपुट के ऊपर Coco', description: 'on: चित्रों के साथ उसकी पट्टी। compact: एक पंक्ति। off: पट्टी बंद करें, उसे वापस बुलाने के लिए छोटा दरवाज़ा रहेगा।' }, language: { label: 'Coco की भाषा', description: 'auto: Claude Code की भाषा सेटिंग के अनुसार, अगर वह नहीं है तो सिस्टम की भाषा।' } },
 id: { band: { label: 'Coco di atas kolom input', description: 'on: bilahnya dengan gambar. compact: satu baris. off: sembunyikan, dengan pintu kecil untuk memanggilnya kembali.' }, language: { label: 'Bahasa Coco', description: 'auto: mengikuti pengaturan bahasa Claude Code, atau bahasa sistem jika belum diatur.' } },
 it: { band: { label: 'Coco sopra il campo di input', description: 'on: la sua barra con le immagini. compact: una riga. off: riporla, con una piccola porta per richiamarla.' }, language: { label: 'Lingua di Coco', description: 'auto: segue la lingua impostata in Claude Code, altrimenti quella del sistema.' } },
 ko: { band: { label: '입력창 위의 코코', description: 'on: 그림이 있는 띠. compact: 한 줄만. off: 접어 두고, 다시 부를 수 있는 작은 문만 남깁니다.' }, language: { label: '코코의 언어', description: 'auto: Claude Code의 언어 설정을 따르고, 설정이 없으면 시스템 언어를 따릅니다.' } },
 'pt-BR': { band: { label: 'Coco acima do campo de entrada', description: 'on: sua faixa com imagens. compact: uma linha. off: guardar, com uma pequena porta para chamá-la de volta.' }, language: { label: 'Idioma da Coco', description: 'auto: segue o idioma definido no Claude Code ou, se não estiver definido, o do sistema.' } },
 'es-419': { band: { label: 'Coco sobre el campo de entrada', description: 'on: su barra con imágenes. compact: una línea. off: guardarla, con una puerta pequeña para llamarla de vuelta.' }, language: { label: 'Idioma de Coco', description: 'auto: sigue el idioma configurado en Claude Code o, si no está definido, el del sistema.' } },
 'es-ES': { band: { label: 'Coco sobre el campo de entrada', description: 'on: su barra con imágenes. compact: una línea. off: guardarla, con una puerta pequeña para llamarla de vuelta.' }, language: { label: 'Idioma de Coco', description: 'auto: sigue el idioma configurado en Claude Code o, si no está definido, el del sistema.' } },
}

export function describeCocoConfig(lang: Lang, input: ConfigDescribeInput): ConfigDescribeResult {
 if (input.key === 'coco.resolvedLanguage') return { label: input.label, description: input.description, isHidden: true }
 const field = input.key === 'coco.band' ? 'band' : input.key === 'coco.language' ? 'language' : undefined
 const words = field ? CONFIG_WORDS[lang][field] : undefined
 return words ? { ...words, isHidden: input.isHidden } : { label: input.label, description: input.description, isHidden: input.isHidden }
}
