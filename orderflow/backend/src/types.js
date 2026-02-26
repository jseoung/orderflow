// ============================================================
// DATA MODELS — OrderFlow MVP
// ============================================================

/**
 * Raw trade tick from any feed
 * @typedef {Object} Tick
 * @property {number} ts          - Unix timestamp ms
 * @property {number} price       - Trade price
 * @property {number} size        - Trade size/quantity
 * @property {'buy'|'sell'|'unknown'} side - Aggressor side
 * @property {string} [id]        - Optional trade ID
 */

/**
 * DOM level entry
 * @typedef {Object} DomLevel
 * @property {number} price
 * @property {number} size
 * @property {'bid'|'ask'} side
 * @property {'added'|'removed'|'modified'|'unchanged'} change
 * @property {number} [prevSize]
 */

/**
 * Footprint bar — one time bar with volume-at-price
 * @typedef {Object} FootprintBar
 * @property {number} openTs       - Bar open timestamp ms
 * @property {number} closeTs      - Bar close timestamp ms (or current)
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} totalVolume
 * @property {number} totalDelta   - totalAskVol - totalBidVol
 * @property {number} totalBidVol
 * @property {number} totalAskVol
 * @property {Map<number, {bidVol:number, askVol:number, delta:number}>} levels
 * @property {Array<{price:number, ratio:number, side:'bid'|'ask'}>} imbalances
 */

/**
 * CVD data point
 * @typedef {Object} CvdPoint
 * @property {number} ts
 * @property {number} cvd          - Cumulative value
 * @property {number} barDelta     - Delta for this bar only
 */

/**
 * Alert
 * @typedef {Object} Alert
 * @property {string} id
 * @property {'large_print'|'delta_threshold'|'tape_speed'|'dom_imbalance'} type
 * @property {string} message
 * @property {number} ts
 * @property {'low'|'medium'|'high'} severity
 * @property {Object} [data]
 */

/**
 * WS message envelope
 * @typedef {Object} WsMessage
 * @property {'tick'|'dom'|'footprint'|'cvd'|'alert'|'metrics'|'replay_status'|'error'} type
 * @property {*} data
 * @property {number} ts
 * @property {string} [seq]        - Sequence number for ordering
 */

module.exports = {};
