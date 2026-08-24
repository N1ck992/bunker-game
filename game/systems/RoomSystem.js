// RoomSystem.js

export class RoomSystem {
  constructor(rooms) {
    /** @type {Room[]} */
    this.rooms = rooms;
  }

  getRoom(id) {
    return this.rooms.find((r) => r.id === id) ?? null;
  }

  accessibleRooms() {
    return this.rooms.filter((r) => r.accessible);
  }

  assignWorker(roomId, characterId, characters) {
    const room = this.getRoom(roomId);
    if (!room) return false;

    // A character can only work one room at a time.
    for (const other of this.rooms) {
      if (other.workers.includes(characterId)) other.unassignWorker(characterId);
    }

    const ok = room.assignWorker(characterId);
    if (ok) {
      const character = characters.find((c) => c.id === characterId);
      if (character) character.assignedRoom = roomId;
    }
    return ok;
  }

  unassignWorker(characterId, characters) {
    for (const room of this.rooms) {
      room.unassignWorker(characterId);
    }
    const character = characters.find((c) => c.id === characterId);
    if (character) character.assignedRoom = null;
  }

  /** Sums production across all accessible rooms, respecting worker fill ratio. */
  totalProduction() {
    const total = { provisions: 0, heat: 0, materials: 0 };
    for (const room of this.rooms) {
      const out = room.currentOutput();
      for (const key of Object.keys(total)) {
        total[key] += out[key] ?? 0;
      }
    }
    return total;
  }
}
