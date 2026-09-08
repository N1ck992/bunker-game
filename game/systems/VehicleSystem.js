// VehicleSystem.js
// Owns the player's squad of combat vehicles (ТЗ п.5/6) — up to
// MAX_SQUAD_VEHICLES machines, each with up to its own crewCapacity heroes
// assigned as leader/adjutant (see Vehicle.js). Purely bookkeeping: no
// rendering, no movement, no damage-dealing — that's the future Battle
// System's job. Also holds the squad-wide "осада" (siege) barrier state,
// since the user confirmed it's one shared barrier for the whole squad,
// not one per vehicle: enemies must break this down before they can reach
// any vehicle/hero at all, but the squad can still fight back while it
// stands (both confirmed by the user).

import { Vehicle } from '../entities/Vehicle.js?v=60';

export const MAX_SQUAD_VEHICLES = 5;

export class VehicleSystem {
  /** @param {Map<string, object>} vehicleDefsById - game/data/vehicles.json entries, keyed by id */
  constructor(vehicleDefsById) {
    this.vehicleDefsById = vehicleDefsById;
    /** @type {Vehicle[]} */
    this.squad = [];

    // Squad-wide siege barrier (ТЗ: "все противники бьют по ограждению...
    // после сноса ограждения враги могут напасть на героев"). Not tied to
    // any one vehicle. `active` is a manual toggle (see activateSiege/
    // deactivateSiege); maxHealth/health are set when siege is turned on.
    // The actual "route incoming damage to the barrier first" logic lives
    // in the future Battle System — this is just the state it will read
    // and mutate.
    this.siege = {
      active: false,
      health: 0,
      maxHealth: 0
    };
  }

  /** Adds a new vehicle instance (built from vehicleDefsById) to the squad, unless it's already full. Returns the new Vehicle, or null if the squad is at MAX_SQUAD_VEHICLES. */
  addVehicle(defId) {
    if (this.squad.length >= MAX_SQUAD_VEHICLES) return null;
    const def = this.vehicleDefsById.get(defId);
    if (!def) return null;
    const vehicle = new Vehicle(def);
    this.squad.push(vehicle);
    return vehicle;
  }

  /** Removes a vehicle from the squad by its instance id. */
  removeVehicle(instanceId) {
    this.squad = this.squad.filter((v) => v.instanceId !== instanceId);
  }

  /**
   * Assigns `characterId` to `role` ('leader' | 'adjutant') on the given
   * vehicle. Refuses if the role doesn't exist for this vehicle's
   * crewCapacity (e.g. no adjutant slot on a 1-seat vehicle), or if that
   * character is already crewing a different vehicle (a hero can only be
   * in one vehicle at a time).
   */
  assignHero(instanceId, characterId, role) {
    const vehicle = this.squad.find((v) => v.instanceId === instanceId);
    if (!vehicle) return false;
    if (role === 'adjutant' && vehicle.crewCapacity < 2) return false;
    if (role !== 'leader' && role !== 'adjutant') return false;

    // A hero can only crew one vehicle — clear them from wherever else
    // they might currently be assigned first.
    this.unassignHeroEverywhere(characterId);

    if (role === 'leader') vehicle.leaderId = characterId;
    else vehicle.adjutantId = characterId;
    return true;
  }

  /** Clears whichever seat (leader/adjutant, on whichever vehicle) `characterId` currently occupies, if any. */
  unassignHeroEverywhere(characterId) {
    for (const vehicle of this.squad) {
      if (vehicle.leaderId === characterId) vehicle.leaderId = null;
      if (vehicle.adjutantId === characterId) vehicle.adjutantId = null;
    }
  }

  /** Every character id currently crewing any vehicle in the squad. */
  allCrewedHeroIds() {
    return this.squad.flatMap((v) => v.crew);
  }

  /** Turns siege mode on for the whole squad with a fresh barrier of `maxHealth`. */
  activateSiege(maxHealth) {
    this.siege.active = true;
    this.siege.maxHealth = maxHealth;
    this.siege.health = maxHealth;
  }

  /** Damages the shared barrier; once it hits 0 siege mode turns itself off (barrier is down, enemies can reach the squad directly). */
  damageBarrier(amount) {
    if (!this.siege.active) return;
    this.siege.health = Math.max(0, this.siege.health - amount);
    if (this.siege.health <= 0) this.siege.active = false;
  }

  deactivateSiege() {
    this.siege.active = false;
    this.siege.health = 0;
    this.siege.maxHealth = 0;
  }

  /** Advances every active vehicle's stat modifiers (timed buffs/debuffs) — call once per frame, same as Character/Enemy. */
  update(dt) {
    for (const vehicle of this.squad) {
      vehicle.stats.update(dt);
    }
  }

  toSaveData() {
    return {
      squad: this.squad.map((v) => v.toSaveData()),
      siege: { ...this.siege }
    };
  }

  /**
   * Rebuilds the squad from a previous toSaveData() blob. Vehicles whose
   * defId no longer exists in vehicleDefsById (e.g. removed/renamed during
   * development) are silently dropped rather than crashing the load —
   * same spirit as Game._loadEnemies skipping unknown spawns.
   */
  restoreFromSave(saveData) {
    if (!saveData) return;
    this.squad = [];
    for (const saved of saveData.squad ?? []) {
      const def = this.vehicleDefsById.get(saved.defId);
      if (!def) continue;
      const vehicle = new Vehicle(def);
      vehicle.instanceId = saved.instanceId;
      vehicle.health = saved.health;
      vehicle.leaderId = saved.leaderId ?? null;
      vehicle.adjutantId = saved.adjutantId ?? null;
      vehicle.state = saved.state ?? 'active';
      this.squad.push(vehicle);
    }
    if (saveData.siege) {
      this.siege = { ...saveData.siege };
    }
  }
}
