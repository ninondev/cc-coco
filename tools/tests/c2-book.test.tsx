import { describe, expect, test } from 'claude-code/testing'
import { pageBlocks } from '../hooks/book'
import type { BookData } from '../hooks/book'
import type { BookWords } from '../hooks/book-words'
import { WORDS } from '../hooks/words'
import { BOOK_FILES } from './book-files'
const words = JSON.parse(BOOK_FILES['en.json']!) as BookWords
const data: BookData = { view: undefined, usage: undefined, store: {}, now: Date.parse('2026-10-05T12:00:00Z'), timeZone: 'UTC', reducedMotion: false, marks: 'replies', voiceSizes: {light:0,full:0}, fortune: undefined, reading:0, own:WORDS.en }
describe('C2 book wiring', () => {
 // BOOK F3 and the unknown-number rule: an unknown figure is one line of words, never a bare dash or a value without its words.
 test('unknown session readings show one line of words after the session heading, not dashes',()=> {
  const blocks = pageBlocks('offerings',words,data)
  const start = blocks.findIndex(b=>b.t==='heading'&&b.text==='This session')
  expect(blocks.slice(start+1).map(b=>'text' in b?b.text:null)).toEqual(['No reading yet.'])
 })
 test('cache follows start time and counted zero remains a rate',()=> {
  const blocks = pageBlocks('offerings',words,{...data,cache:0} as BookData)
  expect(blocks[blocks.length-1]).toEqual({t:'para',text:'Cache hits 0%'})
 })
 test('reminders precede companion and icon and budget requires a valid reading',()=> {
  for(const surface of ['desktop','terminal','vscode','mobile'] as const){
   const blocks = pageBlocks('settings',words,data,surface)
   const choices=blocks.filter(b=>b.t==='choice')
   expect(choices.some(b=>b.t==='choice'&&b.options.some(o=>o.key==='coco:set:guard:on'))).toBe(true)
   expect(choices.some(b=>b.t==='choice'&&b.options.some(o=>o.key==='coco:set:budget:50'))).toBe(false)
  }
 })
 test('reading log keeps its four facts; a stored stamp, omen stamp or count is no page, heading or row now (DECISIONS 1035)',()=> {
  const blocks=pageBlocks('log',words,{...data,store:{stamps:{met:1,omen:2,green:3},omens:4}})
  expect(blocks.slice(0,4).every(b=>b.t==='fact')).toBe(true)
  expect(blocks.some(b=>String(b.t)==='stamps'||b.t==='heading'&&b.text==='Achievements')).toBe(false)
 })
 test('budget choices keep Off first before the three thresholds',()=> {
  const usage = {startedAt:0,rateLimits:[{kind:'five_hour',percentUsed:0,resetsAt:null}]}
  const blocks = pageBlocks('settings',words,{...data,usage} as BookData)
  const budget = blocks.find(b=>b.t==='choice'&&b.options.some(o=>o.key==='coco:set:budget:50'))
  expect(budget?.t==='choice'?budget.options.map(o=>o.value):[]).toEqual(['off','50','80','90'])
 })
})
