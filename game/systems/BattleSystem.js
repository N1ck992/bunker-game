// BattleSystem.js
// Автоматический бой (ТЗ п.9) для связки герой+техника (ТЗ п.6). A vehicle
// with no assigned leader simply doesn't fight — matches "герой сам по
// себе передвигаться не сможет, ему нужна техника": the leader Character
// is who's actually standing on the map (position/sprite/movement-hold
// stay driven through the exact same runtime fields CombatSystem used to
// set — combatState/targetEnemyId/attackCooldown* — so rendering and
// MovementSystem need no changes), but the numbers behind every hit come
// from the vehicle's own stats, boosted by whichever hero(es) crew it.
//
// Damage formula (ТЗ п.7): vehicle's base "attack" stat, increased by
// %firepower (vehicle + leader + adjutant combined — this is exactly the
// "герой усиливает технику" link from ТЗ п.6), then multiplied again by
// %damageIntensity (same combined sources) — an extra multiplier on top
// that applies to any damage type — and finally reduced by the target's
// own %damageResistance. firepower/damageIntensity/damageResistance/
// cooldownReduction are the generic percentage-point stats added in
// Character.js's DEFAULT_BASE_STATS — summing a hero's and a vehicle's
// value for the same stat is just Stats.get(...) on each + addition, no
// special-casing needed.
//
// The leader's own activeAbilities (see game/data/abilities.json /
// AbilitySystem.js) charge on their own prepSeconds while a target is in
// range, then fire automatically — no player input, same "comes online
// periodically" feel as the old SkillSystem. The adjutant's own abilities
// firing *after* the leader's (per the user's description) is a known
// gap, left for a follow-up pass once the leader-side loop is proven out.

const MIN_ATTACK_COOLDOWN_SECONDS = 0.25;
const BASE_ATTACK_COOLDOWN_SECONDS = 2; // baseline before attackSpeed/cooldownReduction — a vehicle with attackSpeed 1 fires every 2s

export class BattleSystem {
  /**
   * @param {AbilitySystem} abilitySystem
   * @param {object} [balance] - game/data/balance.json, for balance.combat.attackAnimSeconds
   * @param {(vehicle:Vehicle, leader:Character, enemy:Enemy) => void} [onEngage]
   * @param {(vehicle:Vehicle, leader:Character, enemy:Enemy) => void} [onAttack]
   * @param {(vehicle:Vehicle, leader:Character, abilityDef:object) => void} [onAbility]
   */
  constructor(abilitySystem, balance, onEngage, onAttack, onAbility) {
    this.abilitySystem = abilitySystem;
    this.combatBalance = balance?.combat ?? {};
    this.onEngage = onEngage;
    this.onAttack = onAttack;
    this.onAbility = onAbility;
  }

  /**
   * @param {VehicleSystem} vehicleSystem
   * @param {Character[]} characters
   * @param {Enemy[]} enemies
   * @param {number} dt
   */
  update(vehicleSystem, characters, enemies, dt) {
    for (const vehicle of vehicleSystem.squad) {
      if (!vehicle.isActive) continue;

      const leader = characters.find((c) => c.id === vehicle.leaderId);
      if (!leader || !leader.isActive) continue;
      const adjutant = vehicle.adjutantId ? characters.find((c) => c.id === vehicle.adjutantId) : null;

      if (leader.attackCooldownRemaining > 0) {
        leader.attackCooldownRemaining = Math.max(0, leader.attackCooldownRemaining - dt);
      }
      if (leader.attackAnimRemaining > 0) {
        leader.attackAnimRemaining = Math.max(0, leader.attackAnimRemaining - dt);
      }
      if (vehicle.tempCooldownRemaining > 0) {
        vehicle.tempCooldownRemaining = Math.max(0, vehicle.tempCooldownRemaining - dt);
        if (vehicle.tempCooldownRemaining === 0) vehicle.tempCooldownReductionPercent = 0;
      }

      const attackRange = vehicle.stats.get('attackRange');
      leader.attackCooldownSeconds = this._effectiveAttackCooldown(vehicle, leader, adjutant);

      const target = this._pickTarget(leader, attackRange, enemies);
      if (!target) {
        leader.combatState = 'idle';
        leader.targetEnemyId = null;
        continue;
      }

      if (leader.combatState !== 'attacking' || leader.targetEnemyId !== target.id) {
        this.onEngage?.(vehicle, leader, target);
      }

      leader.combatState = 'attacking';
      leader.targetEnemyId = target.id;
      leader.facingDir = target.position.col >= leader.position.col ? 1 : -1;
      // The vehicle (via its leader's on-map position) holds ground once
      // engaged — same "combatState 'attacking' freezes movement" contract
      // MovementSystem already enforces for any character.
      leader.path = [];
      leader.moveProgress = 0;

      if (leader.attackCooldownRemaining <= 0) {
        leader.attackCooldownRemaining = leader.attackCooldownSeconds;
        leader.attackAnimRemaining = Math.min(
          this.combatBalance.attackAnimSeconds ?? 0.35,
          leader.attackCooldownSeconds
        );
        leader.attackAnimDuration = leader.attackAnimRemaining;

        const damage = this._computeDamage(vehicle, leader, adjutant, target, vehicle.stats.get('attack'));
        target.takeDamage(damage);
        this.onAttack?.(vehicle, leader, target);
      }

      this._updateActiveAbilities(vehicle, leader, adjutant, target, dt);
    }
  }

  /** Combined value of a "percentage points" style stat (firepower/damageIntensity/cooldownReduction) across the vehicle and its crew — see file header. */
  _combinedPercent(vehicle, leader, adjutant, stat) {
    return vehicle.stats.get(stat) + (leader?.stats.get(stat) ?? 0) + (adjutant?.stats.get(stat) ?? 0);
  }

  /** Base attack (or an ability's already-computed base number), boosted by combined firepower/damageIntensity, then reduced by the target's own damageResistance. */
  _computeDamage(vehicle, leader, adjutant, target, baseAmount) {
    const firepowerPercent = this._combinedPercent(vehicle, leader, adjutant, 'firepower');
    const afterFirepower = baseAmount * (1 + firepowerPercent / 100);

    const intensityPercent = this._combinedPercent(vehicle, leader, adjutant, 'damageIntensity');
    const afterIntensity = afterFirepower * (1 + intensityPercent / 100);

    const resistancePercent = target.stats?.get('damageResistance') ?? 0;
    const final = afterIntensity * (1 - resistancePercent / 100);
    return Math.max(0, final);
  }

  /** Seconds between shots right now — attackSpeed baseline, sped up by combined cooldownReduction (crew passives) and any temporary ability-granted discount. */
  _effectiveAttackCooldown(vehicle, leader, adjutant) {
    const attackSpeed = Math.max(0.1, vehicle.stats.get('attackSpeed'));
    const baseCooldown = BASE_ATTACK_COOLDOWN_SECONDS / attackSpeed;

    const permanentReduction = this._combinedPercent(vehicle, leader, adjutant, 'cooldownReduction');
    const totalReductionPercent = permanentReduction + vehicle.tempCooldownReductionPercent;

    const cooldown = baseCooldown * (1 - totalReductionPercent / 100);
    return Math.max(MIN_ATTACK_COOLDOWN_SECONDS, cooldown);
  }

  /** Charges and auto-fires the leader's active abilities (ТЗ п.8/п.13's "Свинцовый дождь" example) while a target is in range. Adjutant abilities firing after the leader's own is a known follow-up, not implemented yet. */
  _updateActiveAbilities(vehicle, leader, adjutant, target, dt) {
    for (const abilityId of leader.activeAbilities) {
      const remaining = vehicle.abilityCooldowns[abilityId] ?? 0;
      if (remaining > 0) {
        vehicle.abilityCooldowns[abilityId] = Math.max(0, remaining - dt);
        continue;
      }

      const tier = this.abilitySystem.getActiveTier(leader, abilityId);
      if (!tier) continue;

      const abilityBase = vehicle.stats.get('attack') * (tier.damageCoefficient / 100);
      const damage = this._computeDamage(vehicle, leader, adjutant, target, abilityBase);
      target.takeDamage(damage);

      if (tier.cooldownReductionPercent) {
        vehicle.tempCooldownReductionPercent = tier.cooldownReductionPercent;
        vehicle.tempCooldownRemaining = tier.effectDurationSeconds ?? 0;
      }

      vehicle.abilityCooldowns[abilityId] = tier.prepSeconds;
      this.onAbility?.(vehicle, leader, { ...tier, abilityId });
    }
  }

  /** Nearest active enemy within `range` of the leader's on-map position. */
  _pickTarget(leader, range, enemies) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.isActive) continue;
      const d = Math.hypot(leader.position.col - enemy.position.col, leader.position.row - enemy.position.row);
      if (d <= range && d < nearestDist) {
        nearest = enemy;
        nearestDist = d;
      }
    }
    return nearest;
  }
}
