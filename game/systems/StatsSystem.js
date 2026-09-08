// StatsSystem.js
// Generic, data-driven stat container shared by heroes, vehicles and enemies
// (see ТЗ п.7 "Система характеристик" / п.12 "Противники используют те же
// базовые системы"). Nothing in this file knows the *names* of any stat —
// "attack", "defense", "critChance", a brand-new stat added next month —
// they're all just string keys in a plain object. Adding a new stat later
// means adding a key somewhere in data (characters.json/vehicles.json/...),
// not touching this class or the battle code that reads Stats.get(...).
//
// A Stats instance holds, per key:
//   - a base value (Character/Vehicle/Enemy's own number from data)
//   - a list of modifiers, each either:
//       type: 'flat'    - added straight to the base, before percent
//       type: 'percent' - a percentage of the (base + flat) subtotal
//     and each optionally time-limited (duration in seconds; omitted or
//     null = permanent, e.g. gear/passive bonuses rather than a buff).
//
// Computed value = (base + Σflat) * (1 + Σpercent/100), which matches the
// worked example in the ТЗ (100 base, +20% -> 120, then another effect adds
// +30 flat -> applied before the percent step, so ordering is always
// "flat modifiers first, percent modifiers second", never dependent on the
// order addModifier was called in.
//
// This class deliberately does nothing battle-specific (no damage formulas,
// no targeting) — it is pure bookkeeping, used by Character/Enemy/whatever
// Vehicle entity comes in a later stage.

let _nextModifierId = 1;

export class Stats {
  /** @param {Object<string, number>} base - e.g. { health: 100, attack: 12, defense: 4, speed: 3 } */
  constructor(base = {}) {
    this._base = { ...base };
    // stat key -> array of { id, type, value, duration, remaining, source }
    this._modifiers = new Map();
  }

  /** Current base value for `key` (before modifiers), or 0 if never set. */
  getBase(key) {
    return this._base[key] ?? 0;
  }

  /** Overwrites the base value for `key` — e.g. levelling up, or a save file restoring a persisted stat. */
  setBase(key, value) {
    this._base[key] = value;
  }

  /** All stat keys with either a base value or an active modifier. */
  keys() {
    const keys = new Set(Object.keys(this._base));
    for (const key of this._modifiers.keys()) keys.add(key);
    return [...keys];
  }

  /**
   * Adds a modifier and returns its id (for later removeModifier calls).
   * @param {{stat:string, type:'flat'|'percent', value:number, duration?:number|null, source?:string}} mod
   */
  addModifier({ stat, type, value, duration = null, source = null }) {
    const id = `mod_${_nextModifierId++}`;
    const list = this._modifiers.get(stat) ?? [];
    list.push({ id, type, value, duration, remaining: duration, source });
    this._modifiers.set(stat, list);
    return id;
  }

  /** Removes one modifier by the id addModifier returned. */
  removeModifier(id) {
    for (const [stat, list] of this._modifiers) {
      const filtered = list.filter((m) => m.id !== id);
      if (filtered.length) this._modifiers.set(stat, filtered);
      else this._modifiers.delete(stat);
    }
  }

  /** Removes every modifier tagged with this `source` (e.g. all bonuses from one equipped vehicle, or one ability that just expired). */
  removeModifiersFrom(source) {
    for (const [stat, list] of this._modifiers) {
      const filtered = list.filter((m) => m.source !== source);
      if (filtered.length) this._modifiers.set(stat, filtered);
      else this._modifiers.delete(stat);
    }
  }

  /** Advances timed modifiers and drops any that just expired. Permanent modifiers (duration null) are untouched. Call once per frame from whatever owns this Stats instance. */
  update(dt) {
    for (const [stat, list] of this._modifiers) {
      const remaining = [];
      for (const m of list) {
        if (m.remaining == null) {
          remaining.push(m);
          continue;
        }
        m.remaining -= dt;
        if (m.remaining > 0) remaining.push(m);
      }
      if (remaining.length) this._modifiers.set(stat, remaining);
      else this._modifiers.delete(stat);
    }
  }

  /** The fully computed value of `key`: base, plus flat modifiers, times (1 + total percent/100). */
  get(key) {
    const base = this.getBase(key);
    const list = this._modifiers.get(key);
    if (!list || list.length === 0) return base;

    let flatSum = 0;
    let percentSum = 0;
    for (const m of list) {
      if (m.type === 'flat') flatSum += m.value;
      else if (m.type === 'percent') percentSum += m.value;
    }
    return (base + flatSum) * (1 + percentSum / 100);
  }

  toJSON() {
    return { ...this._base };
  }
}
