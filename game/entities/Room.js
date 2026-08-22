// Room.js

export class Room {
  constructor(data) {
    this.id = data.id;
    this.type = data.type;
    this.name = data.name;
    this.position = { ...data.position };
    this.size = { ...data.size };
    this.accessible = data.accessible ?? false;
    this.temperature = data.temperature ?? null;
    this.maxWorkers = data.maxWorkers ?? 0;
    this.workers = [...(data.workers ?? [])]; // array of character ids
    this.production = { ...(data.production ?? {}) };
    this.unlockCost = data.unlockCost ?? null;
    this.description = data.description ?? '';
  }

  canAssignWorker() {
    return this.accessible && this.workers.length < this.maxWorkers;
  }

  assignWorker(characterId) {
    if (!this.canAssignWorker()) return false;
    if (this.workers.includes(characterId)) return false;
    this.workers.push(characterId);
    return true;
  }

  unassignWorker(characterId) {
    this.workers = this.workers.filter((id) => id !== characterId);
  }

  open() {
    this.accessible = true;
  }

  /** Production scaled by how many of the maxWorkers slots are filled. */
  currentOutput() {
    if (!this.accessible || this.maxWorkers === 0) {
      return { water: 0, food: 0, heat: 0, materials: 0 };
    }
    const ratio = this.workers.length / this.maxWorkers;
    const out = {};
    for (const [k, v] of Object.entries(this.production)) {
      out[k] = v * ratio;
    }
    return out;
  }

  toSaveData() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      position: { ...this.position },
      size: { ...this.size },
      accessible: this.accessible,
      temperature: this.temperature,
      maxWorkers: this.maxWorkers,
      workers: [...this.workers],
      production: { ...this.production },
      unlockCost: this.unlockCost,
      description: this.description
    };
  }
}
