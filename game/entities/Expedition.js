// Expedition.js
// Stub for future automatic expeditions to the wasteland (spec section 19).
// Not reachable in this prototype build (surface is locked), but the shape
// exists so ExpeditionSystem has something concrete to operate on later.

export class Expedition {
  constructor(data) {
    this.id = data.id;
    this.memberIds = data.memberIds ?? [];
    this.status = data.status ?? 'idle'; // idle | traveling | returning | complete
    this.startedAt = data.startedAt ?? null;
    this.durationMs = data.durationMs ?? 0;
    this.events = data.events ?? [];
    this.loot = data.loot ?? {};
  }
}
