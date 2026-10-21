// Generated exact band-only book words by tools/build-book-bundle.py.
import type { BookWords } from './book-words'
import type { Lang } from './words'
type BandBookWords = Pick<BookWords, 'durations'> & { noReading: string; offerings: string }
const cached: Partial<Record<Lang, BandBookWords>> = {}
export const BAND_BOOK_WORDS: Record<Lang, BandBookWords> = {
  get "de"(): BandBookWords { return cached["de"] ??= {"noReading":"Noch kein Messwert.","offerings":"Kontingent","durations":["58 Sek.","2 Min. 10 Sek.","12 Min.","1 Std. 2 Min.","2 Tage 3 Std."]} },
  get "en"(): BandBookWords { return cached["en"] ??= {"noReading":"No reading yet.","offerings":"Quota","durations":["58s","2m 10s","12m","1h 2m","2d 3h"]} },
  get "es-419"(): BandBookWords { return cached["es-419"] ??= {"noReading":"Todavía no hay lectura.","offerings":"Cuota","durations":["58 s","2 min 10 s","12 min","1 h 2 min","2 d 3 h"]} },
  get "es-ES"(): BandBookWords { return cached["es-ES"] ??= {"noReading":"Todavía no hay lectura.","offerings":"Cuota","durations":["58 s","2 min 10 s","12 min","1 h 2 min","2 d 3 h"]} },
  get "fr"(): BandBookWords { return cached["fr"] ??= {"noReading":"Pas encore de relevé.","offerings":"Quota","durations":["58 s","2 min 10 s","12 min","1 h 2 min","2 j 3 h"]} },
  get "hi"(): BandBookWords { return cached["hi"] ??= {"noReading":"अभी कोई रीडिंग नहीं।","offerings":"कोटा","durations":["58 से॰","2 मि॰ 10 से॰","12 मि॰","1 घं॰ 2 मि॰","2 दिन 3 घं॰"]} },
  get "id"(): BandBookWords { return cached["id"] ??= {"noReading":"Belum ada angka.","offerings":"Kuota","durations":["58 dtk","2 mnt 10 dtk","12 mnt","1 j 2 mnt","2 h 3 j"]} },
  get "it"(): BandBookWords { return cached["it"] ??= {"noReading":"Ancora nessuna lettura.","offerings":"Quota","durations":["58 s","2 min 10 s","12 min","1 h 2 min","2 gg 3 h"]} },
  get "ja"(): BandBookWords { return cached["ja"] ??= {"noReading":"まだ読み取りがない","offerings":"利用枠","durations":["58秒","2分10秒","12分","1時間2分","2日3時間"]} },
  get "ko"(): BandBookWords { return cached["ko"] ??= {"noReading":"아직 측정값이 없어.","offerings":"한도","durations":["58초","2분 10초","12분","1시간 2분","2일 3시간"]} },
  get "pt-BR"(): BandBookWords { return cached["pt-BR"] ??= {"noReading":"Ainda sem leitura.","offerings":"Cota","durations":["58 s","2 min 10 s","12 min","1 h 2 min","2 dias 3 h"]} },
  get "zh-Hant"(): BandBookWords { return cached["zh-Hant"] ??= {"noReading":"還沒有讀數","offerings":"額度","durations":["58秒","2分10秒","12分","1時2分","2天3時"]} },
  get "zh"(): BandBookWords { return cached["zh"] ??= {"noReading":"还没有读数","offerings":"额度","durations":["58秒","2分10秒","12分","1时2分","2天3时"]} },
}
