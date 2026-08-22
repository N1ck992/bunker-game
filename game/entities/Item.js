// Item.js
// Minimal item model. Only clothing is meaningfully used in this prototype;
// weapon/other slots exist on Character already and are ready for future items.

export class Item {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.slot = data.slot; // 'clothing' | 'weapon' | ...
    this.coldResist = data.coldResist ?? 0;
    this.heatResist = data.heatResist ?? 0;
    this.healthModifier = data.healthModifier ?? 0;
  }
}
