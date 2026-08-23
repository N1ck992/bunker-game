// InventorySystem.js
// Owns the equip/unequip transition between the party's shared backpack
// (one pooled array of item ids, owned by Game.partyInventory — every
// settler draws from and returns to the same stash) and a character's three
// gear slots: character.weapon, character.clothing, character.vehicle.
// Vehicle is kept as its own slot rather than folded into clothing — a
// transport-suit (and later cars, motorcycles, other surface/space suits)
// is a piece of vehicle technology, not amunition or clothing.
// Doesn't know about combat or temperature; those systems just read
// character.weapon/clothing/vehicle directly, exactly as before.

const EQUIPPABLE_SLOTS = new Set(['weapon', 'clothing', 'vehicle']);

export class InventorySystem {
  /** @param {Map<string, Item>} itemsById */
  constructor(itemsById) {
    this.itemsById = itemsById;
  }

  getItem(itemId) {
    return itemId ? this.itemsById.get(itemId) ?? null : null;
  }

  /** The party's shared, unequipped items, resolved to Item instances (unknown ids silently dropped). */
  getPartyInventoryItems(partyInventory) {
    return partyInventory.map((id) => this.itemsById.get(id)).filter(Boolean);
  }

  /**
   * Moves itemId out of the shared party inventory into one character's
   * matching gear slot ('weapon' | 'clothing' | 'vehicle', read from the
   * item itself), swapping whatever was equipped there back into the shared
   * pool. Returns false without changing anything if the item isn't
   * actually in the party inventory.
   * @param {Character} character
   * @param {string} itemId
   * @param {string[]} partyInventory
   */
  equip(character, itemId, partyInventory) {
    const item = this.itemsById.get(itemId);
    if (!item || !EQUIPPABLE_SLOTS.has(item.slot)) return false;
    const index = partyInventory.indexOf(itemId);
    if (index === -1) return false;

    const slot = item.slot;
    const previouslyEquipped = character[slot];
    partyInventory.splice(index, 1);
    if (previouslyEquipped) partyInventory.push(previouslyEquipped);
    character[slot] = itemId;
    return true;
  }

  /** Moves whatever's equipped in the given slot back into the shared party inventory. */
  unequip(character, slot, partyInventory) {
    const itemId = character[slot];
    if (!itemId) return false;
    character[slot] = null;
    partyInventory.push(itemId);
    return true;
  }
}
