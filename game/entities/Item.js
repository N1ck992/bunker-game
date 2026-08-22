// Item.js
// Minimal item model, shared by both gear slots. Clothing items only use
// coldResist/heatResist/healthModifier; weapon items only use
// damage/damageType/range/attackCooldownSeconds — each slot just ignores the
// fields it doesn't need rather than branching on slot type everywhere.

export class Item {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.slot = data.slot; // 'clothing' | 'weapon'
    this.coldResist = data.coldResist ?? 0;
    this.heatResist = data.heatResist ?? 0;
    this.healthModifier = data.healthModifier ?? 0;

    // Weapon-only stats — see CombatSystem.js. attackCooldownSeconds mirrors
    // the enemy unit field of the same name.
    this.damage = data.damage ?? 0;
    this.damageType = data.damageType ?? null; // e.g. 'kinetic'
    this.range = data.range ?? 0; // tiles
    this.attackCooldownSeconds = data.attackCooldownSeconds ?? 1;

    // Path to icon/portrait art. null = no image delivered yet — UI shows a
    // text placeholder instead (see InventoryUI._itemIconHtml).
    this.icon = data.icon ?? null;
  }
}
