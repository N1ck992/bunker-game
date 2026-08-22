// ConstructionSystem.js
// Spends resources to open a pre-authored (not procedurally generated) closed
// door/room. This is the only "construction" verb in the first prototype.

export class ConstructionSystem {
  /**
   * @param {ResourceSystem} resourceSystem
   * @param {RoomSystem} roomSystem
   */
  constructor(resourceSystem, roomSystem) {
    this.resourceSystem = resourceSystem;
    this.roomSystem = roomSystem;
  }

  /**
   * @param {object} interactable - the door/ladder entry from bunker-map.json
   * @param {Room|null} linkedRoom - the room this door unlocks, if any
   */
  tryUnlock(interactable, linkedRoom) {
    if (!interactable.locked) return { ok: false, reason: 'already_unlocked' };

    if (interactable.unlockCondition && interactable.unlockCondition.startsWith('story:')) {
      return { ok: false, reason: 'not_available_yet' };
    }

    const cost = linkedRoom?.unlockCost;
    if (!cost) return { ok: false, reason: 'no_cost_defined' };

    if (!this.resourceSystem.canAfford(cost)) {
      return { ok: false, reason: 'insufficient_resources', cost };
    }

    this.resourceSystem.spend(cost);
    interactable.locked = false;
    interactable.state = 'open';
    if (linkedRoom) linkedRoom.open();

    return { ok: true };
  }
}
