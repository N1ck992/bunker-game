// Item.js
// Minimal item model, shared by every gear slot. Clothing/vehicle items only
// use coldResist/heatResist/healthModifier/allowsTravel; weapon items only
// use damage/damageType/range/attackCooldownSeconds — each slot just ignores
// the fields it doesn't need rather than branching on slot type everywhere.

export class Item {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.slot = data.slot; // 'clothing' | 'weapon' | 'vehicle' | 'key' | 'gadget'
    this.coldResist = data.coldResist ?? 0;
    this.heatResist = data.heatResist ?? 0;
    this.healthModifier = data.healthModifier ?? 0;

    // Clothing/vehicle-only: whether wearing/using this piece is enough to
    // survive outside the bunker. Gates movement on the world map — see
    // Game._canTravelWorldMap. A transport-suit ('vehicle' slot) is the
    // first thing that sets this, not regular clothing.
    this.allowsTravel = data.allowsTravel ?? false;

    // Weapon-only stats — see CombatSystem.js. attackCooldownSeconds mirrors
    // the enemy unit field of the same name.
    this.damage = data.damage ?? 0;
    this.damageType = data.damageType ?? null; // e.g. 'kinetic'
    this.range = data.range ?? 0; // tiles
    this.attackCooldownSeconds = data.attackCooldownSeconds ?? 1;

    // Path to icon/portrait art. null = no image delivered yet — UI shows a
    // text placeholder instead (see InventoryUI._itemIconHtml).
    this.icon = data.icon ?? null;

    // Optional flavor text for the inventory detail view (see
    // InventoryUI._detailHtml). null = section is simply omitted rather
    // than showing placeholder text — no items.json entry has one yet.
    this.description = data.description ?? null;
  }
}
