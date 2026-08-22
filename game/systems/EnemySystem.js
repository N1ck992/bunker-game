// EnemySystem.js
// AI for every enemy on the current map, regardless of race/unit — the
// numbers (aggroRange, damage, ...) come from each Enemy instance, this file
// only implements the shared state machine:
//
//   idle --(character within aggroRange)--> chasing
//   chasing --(within attackDistance)--> attacking
//   chasing --(target lost/too far)--> idle (walks back to spawn)
//   attacking --(target moved out of attackDistance)--> chasing
//
// Movement itself is delegated to the same MovementSystem/PathfindingSystem
// characters use, so enemies obey the same "horizontal movement along one
// row" rule without a second implementation.

const REPATH_INTERVAL_SECONDS = 0.3; // how often a chasing enemy recalculates its path to a moving target
const LEASH_RANGE_TILES = 12; // beyond this, a chasing enemy gives up and goes home even without losing aggro range first

export class EnemySystem {
  /**
   * @param {PathfindingSystem} pathfinder
   * @param {MovementSystem} movementSystem
   * @param {(enemy:Enemy) => void} [onEngage] - called once, the first time an enemy starts attacking
   */
  constructor(pathfinder, movementSystem, onEngage) {
    this.pathfinder = pathfinder;
    this.movementSystem = movementSystem;
    this.onEngage = onEngage;
  }

  /**
   * @param {Enemy[]} enemies
   * @param {Character[]} characters
   * @param {number} dt
   */
  update(enemies, characters, dt) {
    for (const enemy of enemies) {
      if (!enemy.isActive) continue;

      if (enemy.attackCooldownRemaining > 0) {
        enemy.attackCooldownRemaining = Math.max(0, enemy.attackCooldownRemaining - dt);
      }

      const target = this._pickTarget(enemy, characters);

      if (!target) {
        this._goIdle(enemy);
        continue;
      }

      const distance = this._distance(enemy.position, target.position);

      if (distance <= enemy.attackDistance) {
        this._attack(enemy, target, dt);
      } else if (distance <= enemy.aggroRange || enemy.aiState === 'chasing') {
        this._chase(enemy, target, dt);
      } else {
        this._goIdle(enemy);
      }
    }
  }

  /**
   * Keeps chasing the character already engaged (even slightly past
   * aggroRange, up to the leash) rather than flip-flopping between two
   * characters that are both nearby; otherwise picks the nearest active one
   * inside aggroRange.
   */
  _pickTarget(enemy, characters) {
    const active = characters.filter((c) => c.isActive);
    if (active.length === 0) return null;

    if (enemy.aiState === 'chasing' || enemy.aiState === 'attacking') {
      const current = active.find((c) => c.id === enemy.targetCharacterId);
      if (current && this._distance(enemy.position, current.position) <= LEASH_RANGE_TILES) {
        return current;
      }
    }

    let nearest = null;
    let nearestDist = Infinity;
    for (const character of active) {
      const d = this._distance(enemy.position, character.position);
      if (d <= enemy.aggroRange && d < nearestDist) {
        nearest = character;
        nearestDist = d;
      }
    }
    return nearest;
  }

  _chase(enemy, target, dt) {
    enemy.aiState = 'chasing';
    enemy.targetCharacterId = target.id;

    const dirToTarget = target.position.col >= enemy.position.col ? 1 : -1;
    enemy.facingDir = dirToTarget;

    // Stop `attackDistance` tiles short of the character's own tile instead
    // of pathing straight onto it — that's the same number of tiles used
    // below to decide when to attack, so the enemy always ends up exactly
    // at melee range rather than on top of the character. attackDistance is
    // per-unit data (see game/data/enemies/*.json) — bump it for a unit
    // whose sprite is wide and still overlaps visually.
    const stopDistance = Math.max(1, Math.round(enemy.attackDistance));
    const desiredCol = target.position.col - dirToTarget * stopDistance;

    enemy._repathAccumulator += dt;
    const needsNewPath = enemy.path.length === 0 || enemy._repathAccumulator >= REPATH_INTERVAL_SECONDS;
    if (needsNewPath) {
      enemy._repathAccumulator = 0;
      const reachedStandoffTile = this.movementSystem.moveTo(
        enemy,
        { col: desiredCol, row: enemy.position.row },
        this.pathfinder
      );
      // Standoff tile might be a wall/obstacle (e.g. cornered target) —
      // fall back to closing in directly rather than freezing in place.
      if (!reachedStandoffTile) {
        this.movementSystem.moveTo(enemy, { col: target.position.col, row: enemy.position.row }, this.pathfinder);
      }
    }
  }

  _attack(enemy, target, dt) {
    const wasAlreadyAttacking = enemy.aiState === 'attacking';
    enemy.aiState = 'attacking';
    enemy.targetCharacterId = target.id;
    enemy.path = [];
    enemy.facingDir = target.position.col >= enemy.position.col ? 1 : -1;

    if (!wasAlreadyAttacking && !enemy.hasEngagedOnce) {
      enemy.hasEngagedOnce = true;
      this.onEngage?.(enemy, target);
    }

    if (enemy.attackCooldownRemaining <= 0) {
      enemy.attackCooldownRemaining = enemy.attackCooldownSeconds;
      target.takeDamage(enemy.damage);
    }
  }

  _goIdle(enemy) {
    if (enemy.aiState === 'idle' && enemy.path.length === 0) return;

    const atSpawn =
      enemy.position.col === enemy.spawnPosition.col && enemy.position.row === enemy.spawnPosition.row;

    if (enemy.aiState !== 'idle') {
      // Just lost/gave up on a target — head home once, don't keep repathing every frame.
      enemy.aiState = 'idle';
      enemy.targetCharacterId = null;
      if (!atSpawn) {
        this.movementSystem.moveTo(enemy, { ...enemy.spawnPosition }, this.pathfinder);
      }
    }
  }

  _distance(a, b) {
    return Math.hypot(a.col - b.col, a.row - b.row);
  }
}
