// ResourceSystem.js
// Tracks the four base resources and applies production - consumption per tick.
// Deliberately dumb: it doesn't know about rooms or characters directly, it's
// just handed numbers each tick by Game.js.

export class ResourceSystem {
  constructor(balance, initial = {}) {
    this.water = initial.water ?? balance.resources.startingWater;
    this.food = initial.food ?? balance.resources.startingFood;
    this.heat = initial.heat ?? balance.resources.startingHeat;
    this.materials = initial.materials ?? balance.resources.startingMaterials;

    this.consumptionPerCharacter = balance.resources.consumptionPerCharacter;
    this.lastDelta = { water: 0, food: 0, heat: 0, materials: 0 };
  }

  /**
   * @param {{water:number,food:number,heat:number,materials:number}} production
   * @param {number} characterCount - active characters consuming water/food
   */
  applyTick(production, characterCount) {
    const consumption = {
      water: this.consumptionPerCharacter.water * characterCount,
      food: this.consumptionPerCharacter.food * characterCount,
      heat: 0,
      materials: 0
    };

    const delta = {
      water: production.water - consumption.water,
      food: production.food - consumption.food,
      heat: production.heat - consumption.heat,
      materials: production.materials - consumption.materials
    };

    this.water = Math.max(0, this.water + delta.water);
    this.food = Math.max(0, this.food + delta.food);
    this.heat = Math.max(0, this.heat + delta.heat);
    this.materials = Math.max(0, this.materials + delta.materials);

    this.lastDelta = delta;
    return delta;
  }

  /**
   * Adds raw amounts straight away, bypassing production/consumption math.
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
    return { water: this.water, food: this.food, heat: this.heat, materials: this.materials };
  }
}
