'use strict';

/**
 * Confidence-interval math for every rate this site displays (spec WS-3.3
 * section 3.1). Pure, no I/O -- same convention as process.js.
 *
 * Two different quantities are displayed and they need two different
 * treatments -- do not conflate them:
 *
 * (a) WIN RATE / DRAW RATE / LOSS RATE is a binomial proportion (k
 *     successes of n games) -- use wilsonInterval(). The Wilson score
 *     interval inverts the score test rather than assuming asymptotic
 *     normality of the sample proportion, which gives it materially better
 *     coverage than the normal-approximation (Wald) interval at small n and
 *     at proportions near 0 or 1 -- exactly the shape of data this site
 *     displays (many rows are a few hundred games, and some move
 *     percentages sit near the edges).
 *
 * (b) SCORE, i.e. (W + D/2)/n, is NOT a binomial proportion -- it's the
 *     sample mean of a variable taking values 0, 0.5, 1. Applying Wilson to
 *     it would be simply wrong, and would be exactly the impressive-looking-
 *     but-false arithmetic Non-Negotiable 5 (statistical honesty) prohibits.
 *     Use scoreInterval()'s trinomial variance instead. At the n values this
 *     site actually displays a score at (>= minGamesForPct, currently 1000),
 *     the normal approximation this rests on is entirely sound.
 *
 * Both return fractions in [0, 1], matching the convention every other
 * process*.js module in this codebase uses for a raw rate before render.js's
 * formatPct() multiplies by 100 for display. formatInterval() below is the
 * one function that does that multiplication, so every caller converts a
 * half-width to display text exactly one way.
 */

// z for a 95% confidence interval (two-tailed normal, 0.975 quantile).
const Z_95 = 1.959964;

/**
 * Wilson score interval for a binomial proportion k/n.
 *
 * @param {number} k successes (e.g. games won)
 * @param {number} n trials (e.g. games played)
 * @param {number} [z] defaults to the 95% z-value
 * @returns {{low: number, high: number, half: number}} fractions in [0, 1].
 *   `half` is (high - low) / 2 -- NOT high - centre, since Wilson's interval
 *   is not symmetric around its own centre; half-width is defined as the
 *   distance to the wider bound, which is what design-standards.md's
 *   "half-width >= 1.0 percentage point" wide-interval trigger means in
 *   practice (the more conservative of the two distances).
 */
function wilsonInterval(k, n, z = Z_95) {
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0) {
    return { low: 0, high: 0, half: 0 };
  }
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const spread = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const low = Math.max(0, centre - spread);
  const high = Math.min(1, centre + spread);
  return { low, high, half: (high - low) / 2 };
}

/**
 * Confidence interval for a trinomial-scored mean: score = (w + d/2) / n,
 * where each game contributes 0, 0.5, or 1. Uses the normal approximation
 * (sound at this site's minimum displayed sample size, see module doc).
 *
 * @param {number} w wins (for the side being scored)
 * @param {number} d draws
 * @param {number} l losses (for the side being scored) -- used only to
 *   derive n = w + d + l; not otherwise part of the formula.
 * @param {number} [z] defaults to the 95% z-value
 * @returns {{score: number, low: number, high: number, half: number}}
 *   fractions in [0, 1].
 */
function scoreInterval(w, d, l, z = Z_95) {
  const n = (w || 0) + (d || 0) + (l || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return { score: 0, low: 0, high: 0, half: 0 };
  }
  const pw = w / n;
  const pd = d / n;
  const score = pw + pd / 2;
  // Var(score) = E[X^2] - E[X]^2 for X in {0, 0.5, 1} with probabilities
  // {p_l, p_d, p_w}: E[X^2] = p_w * 1 + p_d * 0.25 + p_l * 0 = p_w + 0.25*p_d.
  const variance = Math.max(0, pw + 0.25 * pd - score * score);
  const se = Math.sqrt(variance / n);
  const half = z * se;
  const low = Math.max(0, score - half);
  const high = Math.min(1, score + half);
  return { score, low, high, half };
}

/**
 * Formats a half-width (a FRACTION, same units wilsonInterval()/
 * scoreInterval() return, e.g. 0.004 for 0.4 percentage points) as the
 * "±0.4"-style string spec section 3.2 puts in a .ci span -- one decimal,
 * matching render.js's formatPct().
 *
 * @param {number} halfFraction
 * @returns {string} e.g. "±0.4", or '' when halfFraction isn't a usable number.
 */
function formatInterval(halfFraction) {
  if (typeof halfFraction !== 'number' || !Number.isFinite(halfFraction)) return '';
  return `±${(halfFraction * 100).toFixed(1)}`;
}

module.exports = {
  Z_95,
  wilsonInterval,
  scoreInterval,
  formatInterval,
};
