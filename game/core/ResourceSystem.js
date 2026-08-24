// ResourceSystem.js
// Tracks the three base resources and applies production per tick.
// Deliberately dumb: it doesn't know about rooms or characters directly, it's
// just handed numbers each tick by Game.js.

export class ResourceSystem {
  constructor(balance, initial = {}) {
    this.provisions = initial.provisions ?? balance.resources.startingProvisions;
    this.heat = initial.heat ?? balance.resources.startingHeat;
    this.materials = initial.materials ?? balance.resources.startingMaterials;

    this.lastDelta = { provisions: 0, heat: 0, materials: 0 };
  }

  /**
   * Provisions never drain on their own — only production adds to any of
   * these three, none of them has an automatic per-character upkeep cost.
   * @param {{provisions:number,heat:number,materials:number}} production
   */
  applyTick(production) {
    const delta = {
      provisions: production.provisions ?? 0,
      heat: production.heat ?? 0,
      materials: production.materials ?? 0
    };

    this.provisions = Math.max(0, this.provisions + delta.provisions);
    this.heat = Math.max(0, this.heat + delta.heat);
    this.materials = Math.max(0, this.materials + delta.materials);

    this.lastDelta = delta;
    return delta;
  }

  /**
   * Adds raw amounts straight away, bypassing production math.
   * Used for one-off gains like a character rummaging through furniture.
   * @param {{[resource:string]: number}} amounts
   */
  gain(amounts) {
    for (const [res, amount] of Object.entries(amounts)) {
      if (this[res] === undefined) continue;
      this[res] = Math.max(0, this[res] + amount);
    }
  }

  canAfford(cost) {
    return Object.entries(cost).every(([res, amount]) => (this[res] ?? 0) >= amount);
  }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [res, amount] of Object.entries(cost)) {
      this[res] -= amount;
    }
    return true;
  }

  toSaveData() {
    return { provisions: this.provisions, heat: this.heat, materials: this.materials };
  }
}
