// ConstructionSystem.js
// Spends an item (a key card, currently the only kind — see items.json's
// "slot": "key" entries) to open a locked door/interactable. Used to also
// have a second path — spending bunker resources to unlock a room from the
// old, pre-parallax floor-based bunker layout (rooms.json) — but that
// layout no longer exists (the game now explores individual parallax
// rooms instead), so that path was removed along with rooms.json/
// RoomSystem.js rather than left pointing at data that's gone.

export class ConstructionSystem {
  /**
   * @param {object} interactable - the door/ladder entry from a room scene's interactables
   * @param {string[]} partyInventory - the party's shared backpack, checked for item:* conditions
   */
  tryUnlock(interactable, partyInventory = []) {
    if (!interactable.locked) return { ok: false, reason: 'already_unlocked' };

    if (interactable.unlockCondition && interactable.unlockCondition.startsWith('story:')) {
      return { ok: false, reason: 'not_available_yet' };
    }

    if (interactable.unlockCondition && interactable.unlockCondition.startsWith('item:')) {
      const itemId = interactable.unlockCondition.slice('item:'.length);
      const index = partyInventory.indexOf(itemId);
      if (index === -1) return { ok: false, reason: 'missing_item', itemId };

      partyInventory.splice(index, 1); // key card is spent on use
      interactable.locked = false;
      interactable.state = 'open';
      return { ok: true };
    }

    return { ok: false, reason: 'no_cost_defined' };
  }
}
