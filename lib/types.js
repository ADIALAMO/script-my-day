// /lib/types.js

// Genre as array of allowed values
const Genre = [
  "drama",
  "action",
  "comedy",
  "horror",
  "romance",
  "thriller",
  "comic"
];

// ScriptResult type as JSDoc for reference
/**
 * @typedef {Object} ScriptResult
 * @property {boolean} success
 * @property {string} [output] - Full script text as returned by the LLM
 * @property {string} [error]
 */

module.exports = {
  Genre
};
