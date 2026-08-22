// InventorySystem.js
// Owns the equip/unequip transition between a character's inventory (owned
// but unequipped items) and its two gear slots — character.weapon and
// character.clothing. Doesn't know about combat or temperature; those
// systems just read character.weapon/character.clothing directly, exactly
// as they did before this system existed.

export class InventorySystem {
  /** @param {Map<string, Item>} itemsById */
  constructor(itemsById) {
    this.itemsById = itemsById;
  }

  getItem(itemId) {
    return itemId ? this.itemsById.get(itemId) ?? null : null;
  }

  /** Items a character owns but hasn't equipped, resolved to Item instances (unknown ids silently dropped). */
  getInventoryItems(character) {
    return character.inventory.map((id) => this.itemsById.get(id)).filter(Boolean);
  }

  /**
   * Moves itemId out of the character's inventory into its matching gear
   * slot ('weapon' or 'clothing', read from the item itself), swapping
   * whatever was equipped there back into the inventory. Returns false
   * without changing anything if the item isn't actually in the inventory.
   */
  equip(character, itemId) {
    const item = this.itemsById.get(itemId);
    if (!item || (item.slot !== 'weapon' && item.slot !== 'clothing')) return false;
    if (!character.inventory.includes(itemId)) return false;

    const previouslyEquipped = character[item.slot];
    character.inventory = character.inventory.filter((id) => id !== itemId);
    if (previouslyEquipped) character.inventory.push(previouslyEquipped);
    character[item.slot] = itemId;
    return true;
  }

  /** Moves whatever's equipped in the given slot back into the inventory. */
  unequip(character, slot) {
    const itemId = character[slot];
    if (!itemId) return false;
    character[slot] = null;
    character.inventory.push(itemId);
    return true;
  }
}
