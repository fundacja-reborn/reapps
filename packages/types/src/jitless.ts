/**
 * Side-effect module: configure Zod's global jitless mode BEFORE any schema
 * is constructed.
 *
 * Why a separate file (and not the top of `index.ts`):
 *
 * ESM hoists `import` and `export from` statements. Top-level statements
 * (like `z.config({...})`) run AFTER all imports - including re-exports -
 * are resolved. So putting the config call inline in `index.ts`:
 *
 *   import { z } from 'zod';
 *   z.config({ jitless: true });       // ← runs AFTER export * below
 *   export * from './base';            // ← creates z.object schemas first
 *
 * means every `z.object(...)` in `./base`, `./common`, `./schemas/*` runs
 * before our config takes effect. The $ZodObject constructor at
 * `zod/v4/core/schemas.ts:2099` reads `jit && allowsEval.value`; with the
 * default jitless=false, the right-hand side is evaluated and triggers
 * `new Function("")` - the exact CSP probe we want to skip.
 *
 * Trick: put the config call in its own module and import that module FIRST
 * in `index.ts`. ESM loads dependencies depth-first in source order
 * (ECMA-262 §16.2.1.5), so this module's body runs before any later
 * `export from './x'` resolves its schemas. The result is:
 *   const jit = !globalConfig.jitless;   // = false
 *   const fastEnabled = jit && allowsEval.value;   // short-circuits, .value never read
 *
 * Performance delta of interpreted vs JIT validators is sub-millisecond for
 * our throughput (validateBody + IDB sync). Trade-off explained in
 * docs/development/guidelines/05-data-validation-zod.md.
 *
 * Upstream context: zod/v4/core/util.ts:allowsEval, zod issues #4461, #5414.
 */

import { z } from 'zod';

z.config({ jitless: true });
