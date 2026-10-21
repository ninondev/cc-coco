// tools/c3-algo-worker.ts
import { readFileSync } from "node:fs";
import * as Module from "node:module";
import { fileURLToPath } from "node:url";
var algorithmRoot = new URL("./algo/", import.meta.url).href;
var displayScalar = new URL("./display-slot-text.ts", import.meta.url).href;
var module = Module;
if (typeof module.registerHooks === "function" && typeof module.stripTypeScriptTypes === "function") {
  module.registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith(".") && context.parentURL?.startsWith(algorithmRoot) && !specifier.endsWith(".ts"))
        return { url: new URL(specifier + ".ts", context.parentURL).href, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(algorithmRoot) && url.endsWith(".ts") || url === displayScalar)
        return { format: "module", source: module.stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "strip" }), shortCircuit: true };
      return next(url, context);
    }
  });
}
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const coreName = "./algo-core.mjs";
  const { executeC3Algo } = await import(coreName);
  const result = executeC3Algo(input);
  process.stdout.write(JSON.stringify({ ok: true, result: result ?? null }));
} catch {
  process.stdout.write(JSON.stringify({ ok: false }));
  process.exitCode = 1;
}
