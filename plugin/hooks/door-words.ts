// The owner's three originals, translated in the same plain register.
import type { Lang } from './words'

export const DOOR_WORDS: Record<Lang, { alt: string; wake: string }> = {
  en: { alt: 'claude-sama, asleep', wake: 'Wake him' },
  zh: { alt: 'Claude-sama,睡着了', wake: '叫醒他' },
  ja: { alt: 'Claudeさま、ねむっている', wake: 'かれを起こす' },
  fr: { alt: 'claude-sama, endormi', wake: 'Le réveiller' },
  de: { alt: 'claude-sama, schläft', wake: 'Ihn wecken' },
  hi: { alt: 'claude-sama, सो रहे हैं', wake: 'उन्हें जगाएँ' },
  id: { alt: 'claude-sama, tertidur', wake: 'Bangunkan dia' },
  it: { alt: 'claude-sama, addormentato', wake: 'Sveglialo' },
  ko: { alt: 'claude-sama, 잠들어 있음', wake: '깨우기' },
  'pt-BR': { alt: 'claude-sama, dormindo', wake: 'Acordá-lo' },
  'es-419': { alt: 'claude-sama, dormido', wake: 'Despertarlo' },
  'es-ES': { alt: 'claude-sama, dormido', wake: 'Despertarlo' },
}
