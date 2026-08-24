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
const DEFAULT_ATTACK_ANIM_SECONDS = 0.35; // fallback if balance.combat.attackAnimSeconds is missing

export class EnemySystem {
  /**
   * @param {PathfindingSystem} pathfinder
   * @param {MovementSystem} movementSystem
   * @param {(enemy:Enemy) => void} [onEngage] - called once, the first time an enemy starts attacking
   * @param {object} [balance] - game/data/balance.json, for balance.combat.attackAnimSeconds
   */
  constructor(pathfinder, movementSystem, onEngage, balance) {
    this.pathfinder = pathfinder;
    this.movementSystem = movementSystem;
    this.onEngage = onEngage;
    this.attackAnimSeconds = balance?.combat?.attackAnimSeconds ?? DEFAULT_ATTACK_ANIM_SECONDS;
  }

  /**
   * @param {Enemy[]} enemies
   * @param {Character[]} characters
   * @param {number} dt
   */
  update(enemies, characters, dt) {
    // Refreshed fresh every frame below (see _attack) — a character stops
    // being "under attack" the instant every enemy targeting them backs off
    // or dies, same frame their combatState would too.
    for (const character of characters) character.isBeingAttacked = false;

    for (const enemy of enemies) {
      if (!enemy.isActive) continue;

      if (enemy.attackCooldownRemaining > 0) {
        enemy.attackCooldownRemaining = Math.max(0, enemy.attackCooldownRemaining - dt);
      }
      if (enemy.attackAnimRemaining > 0) {
        enemy.attackAnimRemaining = Math.max(0, enemy.attackAnimRemaining - dt);
      }

      const target = this._pickTarget(enemy, characters);

      if (!target) {
        this._goIdle(enemy);
        continue;
      }

      const distance = this._distance(enemy.position, target.position);

      if (distance <= enemy.attackDistance) {
        this._attack(enemy, target, dt);
      } else if (distance <= enemy.aggroRange || enemy.aiState === 'chasing' || enemy.alerted) {
        // enemy.alerted (see alertFaction below) skips the aggroRange gate
        // the same way an already-chasing enemy does — otherwise an alerted
        // enemy that picked a target beyond its own aggroRange via
        // _pickTarget's detection-range override would fall through to
        // _goIdle on this very first frame, before aiState ever became
        // 'chasing' to satisfy the check on its own.
        this._chase(enemy, target, dt);
      } else {
        this._goIdle(enemy);
      }
    }
  }

  /**
   * Marks every active enemy sharing `raceId` as alerted — called from
   * Game.js the moment any settler engages any one enemy (CombatSystem's
   * onEngage), so attacking a single mutant brings every other mutant on
   * this map down on the party at once, not just that one. See Enemy.alerted
   * and _pickTarget/_detectionRange below for how the flag actually changes
   * targeting once set.
   */
  alertFaction(enemies, raceId) {
    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.raceId !== raceId) continue;
      enemy.alerted = true;
    }
  }

  /** Normally aggroRange; unlimited once an enemy has been alerted (see alertFaction) — an alerted unit hunts the party across the whole map instead of needing them to wander into its own small detection bubble. */
  _detectionRange(enemy) {
    return enemy.alerted ? Infinity : enemy.aggroRange;
  }

  /**
   * Keeps chasing the character already engaged (even slightly past
   * aggroRange, up to the leash) rather than flip-flopping between two
   * characters that are both nearby; otherwise picks the nearest active one
   * inside detection range (aggroRange, or unlimited once alerted).
   */
  _pickTarget(enemy, characters) {
    // Benched settlers (Отряд panel toggle) are held back from the fight —
    // never picked as a target, same as if they weren't on this floor.
    const active = characters.filter((c) => c.isActive && c.inParty !== false);
    if (active.length === 0) return null;

    if (enemy.aiState === 'chasing' || enemy.aiState === 'attacking') {
      const current = active.find((c) => c.id === enemy.targetCharacterId);
      if (current && this._distance(enemy.position, current.position) <= LEASH_RANGE_TILES) {
        return current;
      }
    }

    const detectionRange = this._detectionRange(enemy);

    // The party's tank (set in the Отряд panel) draws attention away from
    // the rest of the group whenever they're in detection range — even if
    // they're not literally the closest settler — so they're the one
    // eating hits up front, per the tank role's whole point.
    const tank = active.find(
      (c) => c.isTank && this._distance(enemy.position, c.position) <= detectionRange
    );
    if (tank) return tank;

    let nearest = null;
    let nearestDist = Infinity;
    for (const character of active) {
      const d = this._distance(enemy.position, character.position);
      if (d <= detectionRange && d < nearestDist) {
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
    // Pins the target in place — see MovementSystem.moveTo and the
    // isBeingAttacked reset at the top of update().
    target.isBeingAttacked = true;
    // The target holds position under fire the same way an attacking
    // character does — clears any tap-to-move order already in flight so
    // getting hit interrupts a walk instead of finishing it. Only done once,
    // right as this attack sequence starts (not every tick it continues):
    // every character is melee-range-1 now, so a mutant attacking from 2-3
    // tiles away leaves SquadCombatSystem one walk-in order to actually
    // close that gap while isBeingAttacked stays true (see
    // MovementSystem.moveTo's allowWhileUnderFire) — wiping the path back
    // to [] on every subsequent tick undid that order before the target
    // could physically cross a single tile, stranding them taking hits
    // forever without ever landing one back.
    if (!wasAlreadyAttacking) {
      target.path = [];
      target.moveProgress = 0;
    }

    if (!wasAlreadyAttacking && !enemy.hasEngagedOnce) {
      enemy.hasEngagedOnce = true;
      this.onEngage?.(enemy, target);
    }

    if (enemy.attackCooldownRemaining <= 0) {
      enemy.attackCooldownRemaining = enemy.attackCooldownSeconds;
      // Brief "strike" animation pulse, same idea as CombatSystem's
      // character.attackAnimRemaining — see Game._renderEnemies, which
      // plays the attack frames only while this is running and an idle
      // "ready" pose the rest of the cooldown, with a reload bar over the
      // head counting up to the next hit.
      enemy.attackAnimRemaining = Math.min(this.attackAnimSeconds, enemy.attackCooldownSeconds);
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
