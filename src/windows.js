// @ts-check
'use strict';

/**
 * Context window per model, matched by prefix (longest wins). Only sizes that are documented
 * or observed live here; anything else is reported as unknown instead of guessed.
 * @type {Record<string, number>}
 */
const BUILTIN = {
  'claude-opus-5': 1000000,       // observed: a session held 281k with room to spare
  'claude-haiku-4-5': 200000,     // documented
};

/**
 * @param {string | undefined} model
 * @param {Record<string, unknown>} [overrides] user setting ctxWatch.contextWindows
 * @returns {number | null} null when the window is unknown
 */
function windowFor(model, overrides) {
  if (!model) return null;
  let best = null;
  let bestLen = -1;
  const consider = (/** @type {Record<string, unknown>} */ table) => {
    for (const prefix of Object.keys(table)) {
      const size = Number(table[prefix]);
      if (!(size > 0) || !model.startsWith(prefix) || prefix.length < bestLen) continue;
      best = size;
      bestLen = prefix.length;
    }
  };
  consider(BUILTIN);
  if (overrides && typeof overrides === 'object') consider(overrides); // ties go to the user
  return best;
}

module.exports = { windowFor, BUILTIN };
