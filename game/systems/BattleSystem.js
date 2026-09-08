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
// %damageIntensity (same combined sources), then adjusted by the armor-
// penetration-vs-armor check below, and finally reduced by the target's
// own %damageResistance. firepower/damageIntensity/damageResistance/
// cooldownReduction/pierce/armor/accuracy are all generic percentage-
// point-style stats added in Character.js's DEFAULT_BASE_STATS — summing
// a hero's and a vehicle's value for the same stat is just Stats.get(...)
// on each + addition (see _combinedPercent), no special-casing needed, so
// a hero ability that boosts a vehicle's pierce/armor/accuracy works the
// same way a firepower-boosting one already does.
//
// Armor penetration vs. armor (ТЗ description, user-supplied "Тяжёлый
// танк" card): a hit whose pierce roughly matches the target's armor
// deals full damage. Under-penetrating (pierce well below armor) bounces
// off for much-reduced damage; over-penetrating (pierce well above armor)
// also reduces damage, since the round passes through without dumping all
// its energy — see _armorMultiplier. Accuracy (see _rollHit) is a flat
// hit-chance roll before any of this; a vehicle with no accuracy value in
// its data (base 0) always hits, so existing/future vehicles that never
// bother defining accuracy aren't silently broken.
//
// The leader's own activeAbilities (see game/data/abilities.json /
// AbilitySystem.js) charge on their own prepSeconds while a target is in
// range, then fire automatically — no player input, same "comes online
// periodically" feel as the old SkillSystem. The adjutant's own abilities
// firing *after* the leader's (per the user's description) is a known
// gap, left for a follow-up pass once the leader-side loop is proven out.

const MIN_ATTACK_COOLDOWN_SECONDS = 0.25;
const BASE_ATTACK_COOLDOWN_SECONDS = 2; // baseline before attackSpeed/cooldownReduction — a vehicle with attackSpeed 1 fires every 2s

// Armor-penetration curve tuning (see _armorMultiplier) — a well-matched
// hit (pierce ≈ armor) deals full damage; both a big under-penetration and
// a big over-penetration ease toward these floors instead of ever hitting
// exactly 0, since the source description says "significantly reduced",
// not "no damage".
const UNDER_PENETRATION_FLOOR = 0.1;
const OVER_PENETRATION_FLOOR = 0.5;

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

        // The shot always fires (animation/cooldown/VFX all happen
        // regardless) — a miss just means _computeDamage never runs, so
        // the target simply takes 0.
        if (this._rollHit(vehicle, leader, adjutant)) {
          const damage = this._computeDamage(vehicle, leader, adjutant, target, vehicle.stats.get('attack'));
          target.takeDamage(damage);
        }
        this.onAttack?.(vehicle, leader, target);
      }

      this._updateActiveAbilities(vehicle, leader, adjutant, target, dt);
    }
  }

  /** Combined value of a "percentage points" style stat (firepower/damageIntensity/cooldownReduction/pierce/armor/accuracy) across the vehicle and its crew — see file header. */
  _combinedPercent(vehicle, leader, adjutant, stat) {
    return vehicle.stats.get(stat) + (leader?.stats.get(stat) ?? 0) + (adjutant?.stats.get(stat) ?? 0);
  }

  /**
   * Whether this shot actually lands — a flat percentage roll against the
   * vehicle+crew's combined accuracy. A vehicle whose data never set an
   * accuracy stat (base 0 — see Vehicle's Stats) always hits: accuracy is
   * an opt-in mechanic, not a trap for every vehicle that doesn't define
   * it. No target-side evasion stat exists yet, so this is attacker-only
   * for now.
   */
  _rollHit(vehicle, leader, adjutant) {
    if (vehicle.stats.getBase('accuracy') <= 0) return true;
    const chance = Math.max(0, Math.min(100, this._combinedPercent(vehicle, leader, adjutant, 'accuracy')));
    return Math.random() * 100 < chance;
  }

  /**
   * Damage multiplier from the armor-penetration-vs-armor matchup (see
   * file header). `overkill` is how far pierce exceeds armor — positive
   * means the round gets through, negative means it doesn't.
   *   - armor <= 0: nothing to penetrate or bounce off of — full damage,
   *     regardless of pierce. Over-penetration is specifically about a
   *     round punching through a PLATE without dumping all its energy;
   *     with no plate there's no such event. (A tank's real-world "weak
   *     against infantry" comes from unit-class counters — see
   *     Vehicle.specialProperties.weakAgainst — not from this formula.)
   *   - overkill ≈ 0 (pierce just barely enough): full damage.
   *   - overkill large and positive (way over-penetrating): eases down
   *     toward OVER_PENETRATION_FLOOR as the round increasingly just
   *     passes through the plate instead of dumping its energy in it.
   *   - overkill large and negative (way under-penetrating): eases down
   *     toward UNDER_PENETRATION_FLOOR as the round increasingly just
   *     bounces off instead of getting through at all.
   */
  _armorMultiplier(pierce, armor) {
    if (armor <= 0) return 1;

    const overkill = pierce - armor;
    if (overkill >= 0) {
      const ratio = Math.min(1, overkill / armor);
      return 1 - (1 - OVER_PENETRATION_FLOOR) * ratio;
    }
    const shortfall = -overkill;
    const ratio = Math.min(1, shortfall / Math.max(pierce, 1));
    return 1 - (1 - UNDER_PENETRATION_FLOOR) * ratio;
  }

  /** Base attack (or an ability's already-computed base number), boosted by combined firepower/damageIntensity, adjusted for armor penetration, then reduced by the target's own damageResistance. */
  _computeDamage(vehicle, leader, adjutant, target, baseAmount) {
    const firepowerPercent = this._combinedPercent(vehicle, leader, adjutant, 'firepower');
    const afterFirepower = baseAmount * (1 + firepowerPercent / 100);

    const intensityPercent = this._combinedPercent(vehicle, leader, adjutant, 'damageIntensity');
    const afterIntensity = afterFirepower * (1 + intensityPercent / 100);

    const pierce = this._combinedPercent(vehicle, leader, adjutant, 'pierce');
    const targetArmor = target.stats?.get('armor') ?? 0;
    const afterArmor = afterIntensity * this._armorMultiplier(pierce, targetArmor);

    const resistancePercent = target.stats?.get('damageResistance') ?? 0;
    const final = afterArmor * (1 - resistancePercent / 100);
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

      if (this._rollHit(vehicle, leader, adjutant)) {
        const abilityBase = vehicle.stats.get('attack') * (tier.damageCoefficient / 100);
        const damage = this._computeDamage(vehicle, leader, adjutant, target, abilityBase);
        target.takeDamage(damage);
      }

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
