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
const DEFAULT_ATTACK_ANIM_SECONDS = 0.35; // fallback if neither the vehicle nor balance.json specify one
// How far into the attack animation the actual hit lands (as a fraction of
// attackAnimDuration) — see the pending-hit mechanism in update()/
// _resolvePendingHit below. 0.85 puts it near the end, matching "the beam
// visually reaches full extension right before impact" rather than
// damage landing instantly the moment the cooldown resets (which used to
// make a slow multi-second charge-up weapon look like it "hits instantly"
// with a disconnected animation playing afterward).
const HIT_POINT_FRACTION = 0.85;

// Armor-penetration curve tuning (see _armorMultiplier) — a well-matched
// hit (pierce ≈ armor) deals full damage; both a big under-penetration and
// a big over-penetration ease toward these floors instead of ever hitting
// exactly 0, since the source description says "significantly reduced",
// not "no damage".
const UNDER_PENETRATION_FLOOR = 0.1;
const OVER_PENETRATION_FLOOR = 0.5;
// How close to the actual moment of impact facing locks in place (see the
// "nearImpact" check in update()) — short enough that it's imperceptible
// as a delay in normal tracking, long enough to stop the muzzle visibly
// snapping direction in the exact frame the shot fires.
const FACING_LOCK_SECONDS = 0.3;

export class BattleSystem {
  /**
   * @param {AbilitySystem} abilitySystem
   * @param {object} [balance] - game/data/balance.json, for balance.combat.attackAnimSeconds
   * @param {(vehicle:Vehicle, leader:Character, enemy:Enemy) => void} [onEngage]
   * @param {(vehicle:Vehicle, leader:Character, enemy:Enemy, result:{damage:number, hit:boolean}) => void} [onAttack]
   * @param {(vehicle:Vehicle, leader:Character, abilityDef:object) => void} [onAbility]
   * @param {(vehicle:Vehicle, leader:Character, newFacingDir:number) => void} [onFacingChange] - diagnostic hook, fired only when BattleSystem itself actually changes a leader's facing — see the battle-log/"вращается" investigation.
   */
  constructor(abilitySystem, balance, onEngage, onAttack, onAbility, onFacingChange) {
    this.abilitySystem = abilitySystem;
    this.combatBalance = balance?.combat ?? {};
    this.onEngage = onEngage;
    this.onAttack = onAttack;
    this.onAbility = onAbility;
    this.onFacingChange = onFacingChange;
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

      // Resolve a shot fired earlier this cycle once its animation reaches
      // the actual "impact" point — see HIT_POINT_FRACTION. Always
      // processed before anything else touches this vehicle/leader this
      // frame, so it lands even if the target died/left range in the
      // meantime (Enemy.takeDamage on an already-dead target is a no-op).
      // hitResolvedThisFrame keeps the facing-lock below true for the
      // exact frame a hit resolves — leader._pendingHit itself gets
      // cleared right here, which would otherwise make the "nearImpact"
      // check further down think there's nothing to protect and let the
      // sprite flip direction in the very frame the shot lands.
      let hitResolvedThisFrame = false;
      if (leader._pendingHit) {
        leader._pendingHit.delayRemaining -= dt;
        if (leader._pendingHit.delayRemaining <= 0) {
          this._resolvePendingHit(leader._pendingHit);
          leader._pendingHit = null;
          hitResolvedThisFrame = true;
        }
      }

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

      // Sticky targeting: keep fighting the SAME enemy as long as it's
      // still alive and in range, instead of re-picking "nearest" fresh
      // every single frame. Without this, a target whose own AI movement
      // nudges it a tile to either side of the leader's column (or a
      // second enemy that's momentarily marginally closer) could flip
      // which enemy/direction counts as "nearest" 60 times a second,
      // making the robot appear to spin and re-target randomly mid-fight
      // instead of committing to whoever it's actually shooting at.
      let target = null;
      if (leader.targetEnemyId) {
        const current = enemies.find((e) => e.id === leader.targetEnemyId);
        if (current?.isActive) {
          const d = Math.hypot(
            leader.position.col - current.position.col,
            leader.position.row - current.position.row
          );
          if (d <= attackRange) target = current;
        }
      }
      if (!target) target = this._pickTarget(leader, attackRange, enemies);

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
      // Track the target continuously (like a turret) rather than only
      // between shots — a long charge-up (2.5s here) is easily enough time
      // for the enemy to walk around to the other side, and freezing
      // facing for the WHOLE swing meant the robot kept visibly aiming
      // at where the enemy used to be until the entire animation finished
      // (confirmed from a screenshot: gun pointing one way, enemy clearly
      // standing on the other side, mid-ability). The only freeze that's
      // actually needed is right at the very end, in the last instant
      // before the shot visually lands (see FACING_LOCK_SECONDS) — that's
      // what stops the muzzle snapping direction in the exact frame it
      // fires; everything before that is free to re-aim.
      const nearImpact = hitResolvedThisFrame || (leader._pendingHit && leader._pendingHit.delayRemaining < FACING_LOCK_SECONDS);
      if (!nearImpact) {
        const newFacing = target.position.col >= leader.position.col ? 1 : -1;
        if (newFacing !== leader.facingDir) {
          this.onFacingChange?.(vehicle, leader, newFacing, target.position.col - leader.position.col);
        }
        leader.facingDir = newFacing;
      }
      // The vehicle (via its leader's on-map position) holds ground once
      // engaged — same "combatState 'attacking' freezes movement" contract
      // MovementSystem already enforces for any character.
      leader.path = [];
      leader.moveProgress = 0;

      if (leader.attackCooldownRemaining <= 0) {
        leader.attackCooldownRemaining = leader.attackCooldownSeconds;
        const animSeconds = vehicle.attackAnimSeconds ?? this.combatBalance.attackAnimSeconds ?? DEFAULT_ATTACK_ANIM_SECONDS;
        leader.attackAnimRemaining = Math.min(animSeconds, leader.attackCooldownSeconds);
        leader.attackAnimDuration = leader.attackAnimRemaining;

        // Damage doesn't land yet — see the pending-hit block at the top
        // of this loop, which resolves it once the animation reaches
        // HIT_POINT_FRACTION of the way through. Any earlier
        // still-pending hit (shouldn't normally happen — the cooldown is
        // always longer than the animation — but just in case) resolves
        // immediately rather than being silently dropped.
        if (leader._pendingHit) this._resolvePendingHit(leader._pendingHit);
        leader._pendingHit = {
          vehicle,
          leader,
          adjutant,
          target,
          delayRemaining: leader.attackAnimDuration * HIT_POINT_FRACTION
        };
      }

      this._updateActiveAbilities(vehicle, leader, adjutant, target, dt);
    }
  }

  /** Actually rolls accuracy, computes damage and applies it, and fires onAttack (VFX/toast/log) — see the pending-hit scheduling in update() above for why this is deferred instead of instant. */
  _resolvePendingHit({ vehicle, leader, adjutant, target }) {
    const hit = this._rollHit(vehicle, leader, adjutant);
    let damage = 0;
    if (hit) {
      damage = this._computeDamage(vehicle, leader, adjutant, target, vehicle.stats.get('attack'));
      target.takeDamage(damage);
    }
    this.onAttack?.(vehicle, leader, target, { damage, hit });
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
      const tier = this.abilitySystem.getActiveTier(leader, abilityId);
      if (!tier) continue;

      if (vehicle.abilityCooldowns[abilityId] === undefined) {
        // First engagement this ability has ever seen — it still has to
        // charge for its full prepSeconds before firing, exactly like any
        // later use (see e.g. "Время подготовки: 8 сек" in the ability's
        // own description). Previously an unset cooldown read as "ready"
        // and fired the ability the very first frame of combat, before
        // any wind-up at all — looked like an instant, un-telegraphed hit.
        vehicle.abilityCooldowns[abilityId] = tier.prepSeconds;
        continue;
      }

      const remaining = vehicle.abilityCooldowns[abilityId];
      if (remaining > 0) {
        vehicle.abilityCooldowns[abilityId] = Math.max(0, remaining - dt);
        continue;
      }

      if (this._rollHit(vehicle, leader, adjutant)) {
        const abilityBase = vehicle.stats.get('attack') * (tier.damageCoefficient / 100);
        const damage = this._computeDamage(vehicle, leader, adjutant, target, abilityBase);
        target.takeDamage(damage);
        this.onAbility?.(vehicle, leader, { ...tier, abilityId, damage, hit: true });
      } else {
        this.onAbility?.(vehicle, leader, { ...tier, abilityId, damage: 0, hit: false });
      }

      if (tier.cooldownReductionPercent) {
        vehicle.tempCooldownReductionPercent = tier.cooldownReductionPercent;
        vehicle.tempCooldownRemaining = tier.effectDurationSeconds ?? 0;
      }

      vehicle.abilityCooldowns[abilityId] = tier.prepSeconds;
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
