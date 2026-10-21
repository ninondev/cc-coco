// The owner's three originals, translated in the same plain register.
import type { Lang } from './words'

export const DOOR_WORDS: Record<Lang, { alt: string; wake: string }> = {
  en: { alt: 'Coco, asleep', wake: 'Wake Coco' },
  zh: { alt: '小克,睡着了', wake: '叫醒她' },
  // BEGIN generated zh-Hant /DOOR_WORDS/zh; OpenCC 0.1.7; s2twp
  "zh-Hant": { alt: "小克,睡著了", wake: "叫醒她" },
  // END generated zh-Hant

  ja: { alt: 'Coco、ねむっている', wake: 'Cocoを起こす' },
  fr: { alt: 'Coco, endormie', wake: 'La réveiller' },
  de: { alt: 'Coco, schläft', wake: 'Coco wecken' },
  hi: { alt: 'Coco, सो रही है', wake: 'उसे जगाएँ' },
  id: { alt: 'Coco, tertidur', wake: 'Bangunkan dia' },
  it: { alt: 'Coco, addormentata', wake: 'Svegliala' },
  ko: { alt: '코코, 잠들어 있음', wake: '깨우기' },
  'pt-BR': { alt: 'Coco, dormindo', wake: 'Acordá-la' },
  'es-419': { alt: 'Coco, dormida', wake: 'Despertarla' },
  'es-ES': { alt: 'Coco, dormida', wake: 'Despertarla' },
}
