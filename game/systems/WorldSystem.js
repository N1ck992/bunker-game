// WorldSystem.js
// Stub for the future global map (spec section 20/21). Only holds the shape
// so it's trivial to fill in later without touching the bunker systems.

export class WorldSystem {
  constructor() {
    this.bunkerPosition = { x: 0, y: 0 };
    this.locations = [];
    this.expeditions = [];
    this.npc = [];
    this.futurePlayers = []; // reserved for eventual online play
  }

  isUnlocked() {
    return false;
  }
}
