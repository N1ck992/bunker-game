// WorldSystem.js
// Groundwork for the future global map (spec section 20/21): a pointy-top
// axial hex grid the player travels across one cell at a time. No art yet —
// Game.js draws plain stroked hexagons — this module only owns the grid
// data, discovery/"visible zone" fog of war, and the travel timer between
// cells. locations/expeditions/npc stay as placeholders for later work.
//
// Axial coordinates (q, r) with cube constraint q+r+s=0 (s implicit).
// Reference: https://www.redblobgames.com/grids/hexagons/ (pointy-top, axial).

const NEIGHBOR_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

const MIN_TRAVEL_MS = 4000;
const MAX_TRAVEL_MS = 6000; // ~5s average, per design

export class WorldSystem {
  /** @param {number} radius - how many rings of hexes exist around the bunker (home) cell. */
  constructor(radius = 6) {
    this.locations = [];
    this.expeditions = [];
    this.npc = [];
    this.futurePlayers = []; // reserved for eventual online play

    this.radius = radius;
    this.hexes = new Map(); // "q,r" -> { q, r }
    this.homeHex = { q: 0, r: 0 };
    this.playerHex = { q: 0, r: 0 };
    this.discovered = new Set(); // "q,r" of every hex ever revealed
    this.traveling = null; // { from, to, elapsed, duration } while mid-transit

    this._generateGrid(radius);
    this._reveal(this.homeHex); // home + its immediate ring start visible
  }

  static key(hex) {
    return `${hex.q},${hex.r}`;
  }

  _generateGrid(radius) {
    for (let q = -radius; q <= radius; q++) {
      const rMin = Math.max(-radius, -q - radius);
      const rMax = Math.min(radius, -q + radius);
      for (let r = rMin; r <= rMax; r++) {
        const hex = { q, r };
        this.hexes.set(WorldSystem.key(hex), hex);
      }
    }
  }

  getHex(q, r) {
    return this.hexes.get(`${q},${r}`) ?? null;
  }

  neighborsOf(hex) {
    return NEIGHBOR_DIRS
      .map((d) => this.getHex(hex.q + d.q, hex.r + d.r))
      .filter(Boolean);
  }

  isAdjacent(a, b) {
    return NEIGHBOR_DIRS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
  }

  isDiscovered(hex) {
    return this.discovered.has(WorldSystem.key(hex));
  }

  /** Reveals a hex and its immediate ring — the "visible zone" the player
   * has actually laid eyes on, distinct from the rest of the fogged grid. */
  _reveal(hex) {
    this.discovered.add(WorldSystem.key(hex));
    for (const n of this.neighborsOf(hex)) this.discovered.add(WorldSystem.key(n));
  }

  /** True while a hex-to-hex transit is underway. */
  get isTraveling() {
    return this.traveling !== null;
  }

  /**
   * Starts moving to an adjacent hex. Only one hex of distance per call —
   * "из соты в соту" — no long-range pathing here, that's future work.
   * @returns {boolean} whether travel actually started.
   */
  tryMoveTo(targetHex) {
    if (this.isTraveling) return false;
    if (!targetHex) return false;
    if (targetHex.q === this.playerHex.q && targetHex.r === this.playerHex.r) return false;
    if (!this.isAdjacent(this.playerHex, targetHex)) return false;

    this.traveling = {
      from: this.playerHex,
      to: targetHex,
      elapsed: 0,
      duration: MIN_TRAVEL_MS + Math.random() * (MAX_TRAVEL_MS - MIN_TRAVEL_MS)
    };
    return true;
  }

  /** @param {number} dt - seconds since last frame, same real-time delta the rest of Game._update uses. */
  update(dt) {
    if (!this.traveling) return;
    this.traveling.elapsed += dt * 1000;
    if (this.traveling.elapsed >= this.traveling.duration) {
      this.playerHex = this.traveling.to;
      this._reveal(this.playerHex);
      this.traveling = null;
    }
  }

  /** 0..1 progress of the current transit, or null if not traveling. */
  get travelProgress() {
    if (!this.traveling) return null;
    return Math.min(1, this.traveling.elapsed / this.traveling.duration);
  }

  /** Pointy-top axial -> pixel, centered on the hex grid's own origin. */
  pixelOf(hex, size) {
    return {
      x: size * Math.sqrt(3) * (hex.q + hex.r / 2),
      y: size * 1.5 * hex.r
    };
  }

  /** Inverse of pixelOf, rounded to the nearest hex (cube rounding). */
  hexAt(x, y, size) {
    const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
    const r = ((2 / 3) * y) / size;
    return this._roundAxial(q, r);
  }

  _roundAxial(q, r) {
    let x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const xDiff = Math.abs(rx - x), yDiff = Math.abs(ry - y), zDiff = Math.abs(rz - z);
    if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
    else if (yDiff > zDiff) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }

  isUnlocked() {
    return false;
  }
}
