// MovementSystem.js
// Advances each character along its `path` (array of {col,row}) at a fixed speed.
// Rendering reads character.position / character.moveProgress but this system
// never touches canvas or images.

export class MovementSystem {
  constructor(balance) {
    this.tilesPerSecond = balance.movement.tilesPerSecond;
  }

  /**
   * @param {Character[]} characters
   * @param {number} dtSeconds
   */
  update(characters, dtSeconds) {
    for (const character of characters) {
      if (!character.isActive) continue;
      if (!character.path || character.path.length === 0) continue;

      character.moveProgress += this.tilesPerSecond * dtSeconds;

      while (character.moveProgress >= 1 && character.path.length > 0) {
        character.moveProgress -= 1;
        const from = character.position;
        const to = character.path.shift();
        if (to.col !== from.col) character.facingDir = to.col > from.col ? 1 : -1;
        character.position = { ...to };
      }

      if (character.path.length === 0) {
        character.moveProgress = 0;
      }
    }
  }

  /**
   * Kick off movement toward a target tile using the given pathfinder.
   * Returns true if a path was found and assigned.
   */
  moveTo(character, target, pathfinder) {
    if (!character.isActive) return false;
    // Characters only (enemies don't have combatState — see Enemy.js's
    // aiState instead, which EnemySystem already handles on its own): once
    // engaged — either firing back (combatState 'attacking') or just being
    // shot at (isBeingAttacked, set every frame by EnemySystem) — a
    // character holds position, no repositioning until the fight actually
    // ends (target dead/out of range, or the attacker breaks off).
    if (character.combatState === 'attacking' || character.isBeingAttacked) return false;
    const path = pathfinder.findPath(character.position, target);
    if (path === null) return false;
    character.path = path;
    character.moveProgress = 0;
    character.animState = 'idle'; // walking cancels any "examining" pose
    return true;
  }
}
