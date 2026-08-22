// ExpeditionSystem.js
// Stub. Automatic expeditions (select settlers -> send -> wait -> events -> return)
// require surface access, which is locked in this first prototype. Kept here so
// Game.js has a stable place to wire it up once the surface scene exists.

export class ExpeditionSystem {
  constructor() {
    /** @type {Expedition[]} */
    this.expeditions = [];
  }

  isAvailable() {
    return false; // gated on surface access in a later stage
  }

  start(memberIds) {
    throw new Error('Expeditions are not available yet — surface access is locked.');
  }

  update(dtSeconds) {
    // no-op for now
  }
}
