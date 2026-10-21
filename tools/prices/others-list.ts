// Makes the other makers' list Coco downloads (OTHERS_URL): LiteLLM's public table run through the plugin's own
// filterOthers, written with the time it was made and read back with the plugin's own readOthersList before it is
// kept. The public repository's prices workflow runs it once a day with Bun and publishes the file on the prices
// branch. Usage: bun tools/prices/others-list.ts OUT.json [SAVED-LITELLM.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as prices from '../../plugin/hooks/cost/prices/index.ts';

const [out, saved] = process.argv.slice(2);
if (!out) throw new Error('usage: others-list.ts OUT.json [SAVED-LITELLM.json]');
let text: string;
if (saved) text = readFileSync(saved, 'utf8');
else {
  const response = await fetch(prices.LITELLM_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`LiteLLM's table answered ${response.status}`);
  text = await response.text();
}
if (!prices.otherResponseWithinLimit(text, prices.LITELLM_MAX_BYTES)) throw new Error("LiteLLM's table is over 8 MB");

const now = new Date();
const makers = prices.filterOthers(JSON.parse(text), now.toISOString().slice(0, 10));
// Most makers missing means LiteLLM changed its format, not that they all left: keep yesterday's list instead.
if (makers.length < Math.ceil(prices.OTHER_MAKERS.length / 2)) throw new Error(`only ${makers.length} makers found`);
const list = { version: prices.OTHERS_LIST_VERSION, generatedAt: now.toISOString(), source: prices.LITELLM_URL, makers };
const body = JSON.stringify(list, null, 1) + '\n';
if (!prices.otherResponseWithinLimit(body)) throw new Error('the list is over 64 KB');
prices.readOthersList(JSON.parse(body), now.getTime());
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body);
console.log(`${out}: ${makers.length} makers, ${makers.reduce((n, m) => n + m.models.length, 0)} models, ${body.length} bytes`);
