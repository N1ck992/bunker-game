// CombatSystem.js
// Lets characters fight back. Unlike EnemySystem, a character never chases —
// movement stays entirely under player control via tap-to-move — it just
// auto-attacks whatever active enemy is within its equipped weapon's range,
// on that weapon's own cooldown. No weapon equipped -> falls back to
// UNARMED_ATTACK below (bare-handed melee) rather than standing there doing
// nothing — a settler always has *some* way to fight back.

// Bare-handed fallback, shaped exactly like a weapon item (see items.json)
// so CombatSystem/Game can treat it identically to an equipped weapon. Short
// melee range, modest damage, slightly slower than the one gun currently in
// the game — good enough to survive with, not a replacement for gearing up.
export const UNARMED_ATTACK = Object.freeze({
  id: 'unarmed',
  name: 'Врукопашную',
  slot: 'weapon',
  damage: 4,
  damageType: 'kinetic',
  range: 1,
  attackCooldownSeconds: 1.4
});

// A weapon with range 1 is close enough to be swung/punched rather than
// aimed and fired — that's the melee/ranged split ловкость cares about (see
// _effectiveCooldownSeconds). UNARMED_ATTACK (range 1) counts as melee too,
// so bare-handed fighters still benefit from agility.
const MELEE_RANGE_THRESHOLD = 1;

// Floor on the agility-boosted cooldown so a very high-ловкость melee
// fighter still has *some* gap between swings, rather than tending to 0.
const MIN_ATTACK_COOLDOWN_SECONDS = 0.25;

export class CombatSystem {
  /**
   * @param {Map<string, Item>} itemsById
   * @param {object} balance - game/data/balance.json, for balance.combat.* (agility attack-speed tuning)
   * @param {(character:Character, enemy:Enemy, weapon:Item) => void} [onEngage] - called whenever a character starts attacking a (new) target
   * @param {(character:Character, enemy:Enemy, weapon:Item) => void} [onAttack] - called every time a shot actually fires (for hit-effect visuals)
   */
  constructor(itemsById, balance, onEngage, onAttack) {
    this.itemsById = itemsById;
    this.combatBalance = balance?.combat ?? {};
    this.onEngage = onEngage;
    this.onAttack = onAttack;
  }

  /**
   * @param {Character[]} characters
   * @param {Enemy[]} enemies
   * @param {number} dt
   */
  update(characters, enemies, dt) {
    for (const character of characters) {
      if (!character.isActive) continue;
      // Benched settlers (see PartyUI/CharacterRosterUI's "Отряд" button)
      // stay out of the fight entirely, same as having no weapon equipped.
      if (character.inParty === false) continue;

      if (character.attackCooldownRemaining > 0) {
        character.attackCooldownRemaining = Math.max(0, character.attackCooldownRemaining - dt);
      }
      if (character.attackAnimRemaining > 0) {
        character.attackAnimRemaining = Math.max(0, character.attackAnimRemaining - dt);
      }

      const weapon = CombatSystem.effectiveWeapon(character, this.itemsById);
      // Recomputed every frame (not just on fire) so the on-head reload bar
      // (see Game._renderCharacters) always reflects the current weapon +
      // agility, even if either changes mid-fight.
      character.attackCooldownSeconds = this._effectiveCooldownSeconds(character, weapon);

      const target = this._pickTarget(character, weapon, enemies);
      if (!target) {
        character.combatState = 'idle';
        character.targetEnemyId = null;
        continue;
      }

      if (character.combatState !== 'attacking' || character.targetEnemyId !== target.id) {
        this.onEngage?.(character, target, weapon);
      }

      character.combatState = 'attacking';
      character.targetEnemyId = target.id;
      character.facingDir = target.position.col >= character.position.col ? 1 : -1;
      // From this frame on the character holds position — see
      // MovementSystem.moveTo, which now refuses new orders while
      // combatState is 'attacking'. Clearing any in-progress path here
      // covers the case where a target wanders into range mid-walk.
      character.path = [];
      character.moveProgress = 0;

      if (character.attackCooldownRemaining <= 0) {
        character.attackCooldownRemaining = character.attackCooldownSeconds;
        // Brief "swing/shot" animation pulse — see Game._renderCharacters,
        // which shows the attack frames only while this is running and an
        // idle "ready" pose the rest of the cooldown, with a reload bar
        // over the head counting up to the next shot.
        character.attackAnimRemaining = Math.min(
          this.combatBalance.attackAnimSeconds ?? 0.35,
          character.attackCooldownSeconds
        );
        target.takeDamage(weapon.damage);
        this.onAttack?.(character, target, weapon);
      }
    }
  }

  /** The item in `character`'s weapon slot, or UNARMED_ATTACK if empty/invalid — shared with Game._commandAttack so manual "Атаковать" orders agree with what CombatSystem will actually fire with. */
  static effectiveWeapon(character, itemsById) {
    const weapon = character.weapon ? itemsById.get(character.weapon) : null;
    return weapon && weapon.slot === 'weapon' ? weapon : UNARMED_ATTACK;
  }

  /** A weapon close enough in range to be melee (fists, knives, ...) rather than aimed/fired at a distance — see MELEE_RANGE_THRESHOLD. */
  static isMelee(weapon) {
    return weapon.range <= MELEE_RANGE_THRESHOLD;
  }

  /**
   * How long, in seconds, `character` actually waits between attacks with
   * `weapon` right now. Ranged weapons (a revolver, the kinetic pistol, ...)
   * always fire on their own flat cooldown from items.json — ловкость only
   * makes someone's hands faster, not their trigger-to-target aim, so it
   * only speeds up melee. Every agility point above the party baseline
   * (balance.combat.agilityBaseline) shaves a percentage
   * (balance.combat.meleeAgilityAttackSpeedPercent) off the weapon's base
   * cooldown; a point below baseline slows it down the same way. Floored at
   * MIN_ATTACK_COOLDOWN_SECONDS so it never approaches an instant attack.
   */
  _effectiveCooldownSeconds(character, weapon) {
    const baseCooldown = weapon.attackCooldownSeconds;
    if (!CombatSystem.isMelee(weapon)) return baseCooldown;

    const baseline = this.combatBalance.agilityBaseline ?? 5;
    const percentPerPoint = this.combatBalance.meleeAgilityAttackSpeedPercent ?? 0;
    const speedMultiplier = 1 + (character.agility - baseline) * (percentPerPoint / 100);
    const cooldown = baseCooldown / Math.max(0.1, speedMultiplier);
    return Math.max(MIN_ATTACK_COOLDOWN_SECONDS, cooldown);
  }

  /** Nearest active enemy within the weapon's range — ranged weapons don't need to pick "the" target the way melee standoff does. */
  _pickTarget(character, weapon, enemies) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const enemy of enemies) {
      if (!enemy.isActive) continue;
      const d = this._distance(character.position, enemy.position);
      if (d <= weapon.range && d < nearestDist) {
        nearest = enemy;
        nearestDist = d;
      }
    }
    return nearest;
  }

  _distance(a, b) {
    return Math.hypot(a.col - b.col, a.row - b.row);
  }
}
