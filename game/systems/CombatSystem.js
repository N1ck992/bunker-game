// CombatSystem.js
// Lets characters fight back. Unlike EnemySystem, a character never chases —
// movement stays entirely under player control via tap-to-move — it just
// auto-attacks whatever active enemy is within its equipped weapon's range,
// on that weapon's own cooldown. No weapon equipped -> character never
// attacks, same as an enemy with no target just standing idle.

export class CombatSystem {
  /**
   * @param {Map<string, Item>} itemsById
   * @param {(character:Character, enemy:Enemy, weapon:Item) => void} [onEngage] - called whenever a character starts attacking a (new) target
   * @param {(character:Character, enemy:Enemy, weapon:Item) => void} [onAttack] - called every time a shot actually fires (for hit-effect visuals)
   */
  constructor(itemsById, onEngage, onAttack) {
    this.itemsById = itemsById;
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

      if (character.attackCooldownRemaining > 0) {
        character.attackCooldownRemaining = Math.max(0, character.attackCooldownRemaining - dt);
      }

      const weapon = character.weapon ? this.itemsById.get(character.weapon) : null;
      if (!weapon || weapon.slot !== 'weapon') {
        character.combatState = 'idle';
        character.targetEnemyId = null;
        continue;
      }

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

      if (character.attackCooldownRemaining <= 0) {
        character.attackCooldownRemaining = weapon.attackCooldownSeconds;
        target.takeDamage(weapon.damage);
        this.onAttack?.(character, target, weapon);
      }
    }
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
