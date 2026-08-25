// SkillSystem.js
// Passive "ultimate" abilities — see game/data/skills.json for the data
// and Character.skillId/concentration/concentrationMax for the per-hero
// state. Every character with a skillId charges their own Концентрация
// bar on its own while they're in the fight; on filling up, the skill
// fires by itself (no player input) and the bar resets to 0. Purely
// real-time, layered on top of the existing CombatSystem/EnemySystem loop
// — it doesn't change how normal attacks work.

export class SkillSystem {
  /**
   * @param {Map<string, object>} skillsById - game/data/skills.json entries, keyed by id
   * @param {object} [balance] - game/data/balance.json, for balance.combat.concentrationBaseline
   * @param {(character:Character, skill:object) => void} [onTrigger] - called every time a skill fires, for toasts/VFX
   */
  constructor(skillsById, balance, onTrigger) {
    this.skillsById = skillsById;
    this.concentrationBaseline = balance?.combat?.concentrationBaseline ?? 5;
    this.onTrigger = onTrigger;
  }

  /**
   * @param {Character[]} characters
   * @param {Enemy[]} enemies
   * @param {number} dt
   */
  update(characters, enemies, dt) {
    for (const character of characters) {
      if (character.shieldRemaining > 0) {
        character.shieldRemaining = Math.max(0, character.shieldRemaining - dt);
      }

      if (!character.isActive || character.inParty === false || !character.skillId) continue;
      const skill = this.skillsById.get(character.skillId);
      if (!skill) continue;

      // "В бою" — either actively fighting something themselves, or being
      // shot at — either way charges the same way; a settler who's simply
      // walking around the bunker with nobody around doesn't build charge.
      const inCombat = character.combatState === 'attacking' || character.isBeingAttacked;
      if (!inCombat) continue;

      // The концентрация attribute scales how long skill.chargeSeconds
      // (the baseline time, at concentrationBaseline) actually takes —
      // double the attribute roughly halves the wait, same shape as
      // CombatSystem's agility-vs-agilityBaseline attack-speed scaling.
      const effectiveChargeSeconds = skill.chargeSeconds * (this.concentrationBaseline / Math.max(1, character.concentration));
      character.skillCharge = Math.min(
        character.skillChargeMax,
        character.skillCharge + (character.skillChargeMax / effectiveChargeSeconds) * dt
      );

      if (character.skillCharge >= character.skillChargeMax) {
        character.skillCharge = 0;
        this._trigger(character, skill, characters, enemies);
      }
    }
  }

  _trigger(character, skill, characters, enemies) {
    switch (skill.type) {
      case 'boosted_attack': {
        const target = enemies.find((e) => e.id === character.targetEnemyId && e.isActive);
        if (target) target.takeDamage(skill.damage);
        break;
      }
      case 'mass_attack': {
        for (const enemy of enemies) {
          if (!enemy.isActive) continue;
          if (this._distance(character.position, enemy.position) <= skill.radius) {
            enemy.takeDamage(skill.damage);
          }
        }
        break;
      }
      case 'guardian_shield': {
        for (const ally of characters) {
          if (!ally.isActive || ally.inParty === false) continue;
          if (this._distance(character.position, ally.position) <= skill.radius) {
            ally.shieldRemaining = Math.max(ally.shieldRemaining, skill.duration);
          }
        }
        break;
      }
    }
    this.onTrigger?.(character, skill);
  }

  _distance(a, b) {
    return Math.hypot(a.col - b.col, a.row - b.row);
  }
}
