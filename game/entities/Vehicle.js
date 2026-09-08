// Vehicle.js
// One instance of combat "техника" (ТЗ п.5/6) — an air/ground/water unit
// that pairs with up to crewCapacity heroes. Deliberately as dumb as
// Character.js/Enemy.js: data + a bit of crew bookkeeping, no rendering,
// no movement, no battle math. Wiring this into the bunker map (replacing
// the on-foot Character sprite with the vehicle itself, per the user's
// "техника будет заменять героя прямо в бункере") is a later, separate
// step — this class only needs to exist and hold correct data for that.
//
// NOT the same thing as items.json's "vehicle"-slot equipment
// (transport_suit, which just permits world-map travel — see
// Character.vehicle/Game._canTravelWorldMap). This is a full combat
// entity with its own stats and crew; that stays untouched.
//
// One instance = one vehicle in the player's squad (see VehicleSystem),
// built from a definition in game/data/vehicles.json. Multiple instances
// can share the same definition id (e.g. two identical cyber-suits), the
// same way Enemy instances can share a unitDef.

import { Stats } from '../systems/StatsSystem.js?v=53';

let _nextInstanceId = 1;

export class Vehicle {
  /** @param {object} def - an entry from game/data/vehicles.json */
  constructor(def) {
    this.instanceId = `vehicle_${_nextInstanceId++}`;
    this.defId = def.id;
    this.name = def.name;
    this.description = def.description ?? '';
    this.category = def.category; // 'air' | 'ground' | 'water'
    // Weight class — a separate axis from category (e.g. a "heavy" ground
    // vehicle vs a "light" one). Free-form string, nothing branches on it
    // yet; same forward-looking-tag spirit as Character.heroType.
    this.weightClass = def.weightClass ?? null;
    // Narrower classification within weightClass/category (e.g. "heavy_tank"
    // vs some other heavy ground vehicle) — drives future rock-paper-
    // scissors style counters (see specialProperties.strongAgainst/
    // weakAgainst below). Free-form, same spirit as heroType.
    this.unitClass = def.unitClass ?? null;
    this.faction = def.faction ?? null; // null = usable by any faction
    // Single static icon/portrait, if the vehicle has one — separate from
    // the animated walk-cycle frames below.
    this.sprite = def.sprite ?? null;
    // Walk-cycle animation frames (see game/assets/vehicles/.../run_left,
    // run_right) — same left/right split idea as Character's runLeft/
    // runRight sprite sets. Empty arrays for a vehicle with no art yet.
    this.sprites = {
      runLeft: def.sprites?.runLeft ?? [],
      runRight: def.sprites?.runRight ?? [],
      // Attack animation frames — same left/right split. Optional: a
      // vehicle with no dedicated attack art (empty arrays) just holds
      // its idle/run pose while attacking instead (see Game._renderCharacters).
      attackLeft: def.sprites?.attackLeft ?? [],
      attackRight: def.sprites?.attackRight ?? []
    };
    this.damageType = def.damageType ?? null;
    // Optional override for how long the attack animation actually plays
    // (seconds) — see game/systems/BattleSystem.js/Game._renderCharacters.
    // null falls back to balance.json's combat.attackAnimSeconds. Exists
    // per-vehicle (not just in balance.json) because a heavy weapon's
    // multi-second charge-up animation needs a very different pacing than
    // a quick sidearm swing would.
    this.attackAnimSeconds = def.attackAnimSeconds ?? null;

    this.stats = new Stats({ ...def.stats });
    this.health = this.stats.get('maxHealth');

    // Innate permanent modifiers, same pattern as Character.js — kept as
    // plain data too (not just applied into Stats) so a save can
    // round-trip them; Stats.toJSON() only exports raw base values.
    this.modifiers = def.modifiers ?? [];
    for (const mod of this.modifiers) {
      this.stats.addModifier({ ...mod, duration: null, source: `vehicle:${this.instanceId}` });
    }

    // Ability hooks — same forward-looking shape as Character.js; nothing
    // resolves these yet, waiting on the future ability/effect data format.
    this.abilities = def.abilities ?? [];
    this.passiveAbilities = def.passiveAbilities ?? [];
    this.specialProperties = def.specialProperties ?? {};

    // Crew (ТЗ: "в каждой технике могут быть по два героя, лидер и
    // адъютант"). crewCapacity isn't hardcoded to 2 at this class's level
    // (see vehicles.json comment) even though every current definition
    // uses 2 — a future vehicle type could define a different crew size
    // without this class changing.
    this.crewCapacity = def.crewCapacity ?? 2;
    // Character id of whoever leads this vehicle — the one actually shown
    // in the bunker/on the battlefield once the map-integration stage
    // wires that up (see file header). null = unmanned/empty slot.
    this.leaderId = null;
    // Character id of the adjutant — not shown separately, "on comms"
    // with the leader; acts after the leader (own abilities fire second).
    // Only meaningful when crewCapacity >= 2.
    this.adjutantId = null;

    this.state = 'active'; // 'active' | 'destroyed'

    // Battle runtime state (see game/systems/BattleSystem.js) — not saved,
    // same spirit as Character's attackCooldownRemaining/combatState.
    // Active-ability cooldowns, keyed by ability id (an ability is
    // "charging" while its remaining value counts down from
    // tier.prepSeconds; ready to fire again at 0/undefined).
    this.abilityCooldowns = {};
    // Temporary attack-cooldown discount from an ability's own secondary
    // effect (e.g. "Свинцовый дождь"'s "снижает время заряжания... на N%
    // на M сек") — a percentage, decaying to 0 once tempCooldownRemaining
    // runs out. Separate from the permanent cooldownReduction stat (crew
    // passives), which BattleSystem always adds on top of this.
    this.tempCooldownReductionPercent = 0;
    this.tempCooldownRemaining = 0;
  }

  get isActive() {
    return this.state === 'active';
  }

  /** Every currently-assigned crew member's character id, leader first. */
  get crew() {
    return [this.leaderId, this.adjutantId].filter(Boolean);
  }

  takeDamage(amount) {
    if (this.state === 'destroyed') return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.state = 'destroyed';
  }

  toSaveData() {
    return {
      instanceId: this.instanceId,
      defId: this.defId,
      health: this.health,
      leaderId: this.leaderId,
      adjutantId: this.adjutantId,
      state: this.state
    };
  }
}
