// MovementSystem.js
// Advances each character along its `path` (array of {col,row}) at a fixed speed.
// Rendering reads character.position / character.moveProgress but this system
// never touches canvas or images.
//
// Also owns runPhase — how far into the run-cycle each entity's animation
// currently is, in "frames" (a float; the renderer just floors it). Kept
// here rather than in Game.js's render step because it's derived directly
// from how far the entity has actually travelled this frame
// (tilesPerSecond * dt), not from wall-clock time — so a slower mover's
// legs cycle slower and a faster one's cycle faster, they never carry on
// mid-stride the instant a path empties (reset to 0 below), and two
// entities that started moving at different moments don't end up
// lockstepped just because they share the same walk cycle (the old
// this._now-based formula gave everyone the exact same phase, since it
// depended on absolute time; distance-based phase depends on each one's
// own path/position instead).

const RUN_FRAMES_PER_TILE = 0.7; // matches the old fixed RUN_FPS(7) / tilesPerSecond(10) —
                                  // same visual cadence, just driven by distance now instead of time

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
      if (!character.path || character.path.length === 0) {
        // Not moving (or never was) — hold at frame 0 so the next run
        // cycle always starts clean instead of resuming wherever the last
        // one left off.
        character.runPhase = 0;
        continue;
      }

      character.moveProgress += this.tilesPerSecond * dtSeconds;
      character.runPhase = (character.runPhase ?? 0) + this.tilesPerSecond * dtSeconds * RUN_FRAMES_PER_TILE;

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
   * @param {{allowWhileUnderFire?: boolean}} [options] - set only by
   *   SquadCombatSystem's own formation walk-in (see there for why).
   */
  moveTo(character, target, pathfinder, { allowWhileUnderFire = false } = {}) {
    if (!character.isActive) return false;
    // Characters only (enemies don't have combatState — see Enemy.js's
    // aiState instead, which EnemySystem already handles on its own): once
    // already firing back (combatState 'attacking'), a character holds
    // position — no player-issued repositioning until the fight actually
    // ends (target dead/out of range, or the attacker breaks off). Merely
    // being shot at (isBeingAttacked, set every frame by EnemySystem) blocks
    // player orders the same way — no kiting away mid-fight — but
    // SquadCombatSystem passes allowWhileUnderFire so it can still walk a
    // melee character the rest of the way into their own swing range: with
    // every weapon in the game melee-range-1 now, an enemy attacking from
    // 2-3 tiles away leaves the target isBeingAttacked without them ever
    // being close enough to hit back, and without this bypass they'd be
    // stuck taking hits forever.
    if (character.combatState === 'attacking') return false;
    if (character.isBeingAttacked && !allowWhileUnderFire) return false;
    const path = pathfinder.findPath(character.position, target);
    if (path === null) return false;
    character.path = path;
    character.moveProgress = 0;
    character.animState = 'idle'; // walking cancels any "examining" pose
    return true;
  }
}
