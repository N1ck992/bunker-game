// Enemy.js
// Data + runtime state for one spawned hostile (any race/unit). The combat/
// aggro decision-making lives in EnemySystem.js — this class is deliberately
// as dumb as Character.js, just holding numbers and current state.
//
// One instance = one enemy standing on the map, built from a spawn entry in
// the level's map JSON ("enemies" array: id/raceId/unitId/col/row) plus the
// matching unit definition from game/data/enemies/<raceId>.json. Multiple
// instances can share the same raceId+unitId (and therefore the same sprite
// set — see Game._loadEnemySprites, which caches per unit type).

export class Enemy {
  /**
   * @param {{id:string, raceId:string, unitId:string, col:number, row:number}} spawn
   * @param {object} unitDef - the matching entry from the race's units[]
   */
  constructor(spawn, unitDef) {
    this.id = spawn.id;
    this.raceId = spawn.raceId;
    this.unitId = spawn.unitId;
    this.name = unitDef.name;

    // Combat/movement stats, straight from data — see game/data/enemies/README.md
    this.maxHealth = unitDef.health;
    this.health = unitDef.health;
    this.damage = unitDef.damage;
    // Tile gap the enemy keeps from its target: it stops chasing this many
    // tiles away and attacks from there, so it never stands on the same
    // tile as (or visually overlapping) the character. Tune per unit in
    // game/data/enemies/*.json — wider sprites need a bigger number.
    this.attackDistance = unitDef.attackDistance;
    this.aggroRange = unitDef.aggroRange;
    this.attackCooldownSeconds = unitDef.attackCooldownSeconds;
    this.tilesPerSecond = unitDef.tilesPerSecond;

    // Item ids that appear on the corpse once this unit dies — see
    // Game._onCorpseTapped, which grants them to the acting character and
    // flips lootCollected so the corpse can't be searched twice.
    this.loot = unitDef.loot ? [...unitDef.loot] : [];
    this.lootCollected = false;

    this.spawnPosition = { col: spawn.col, row: spawn.row };
    this.position = { col: spawn.col, row: spawn.row };
    this.facingDir = 1;

    // 'idle' | 'chasing' | 'attacking' | 'dead' — drives both AI and which
    // animation frames render (see Game._renderEnemies).
    this.aiState = 'idle';
    this.targetCharacterId = null;
    this.attackCooldownRemaining = 0;
    // Brief pulse set by EnemySystem._attack each time a hit actually
    // lands — Game._renderEnemies plays the attack sprite frames only
    // while this is running, so the loop doesn't read as nonstop
    // attacking; the rest of attackCooldownRemaining is shown as an idle
    // "ready" pose plus a reload bar over the head (see attackCooldownRemaining/attackCooldownSeconds).
    this.attackAnimRemaining = 0;
    this.hasEngagedOnce = false; // so Game can toast only on the first engagement

    // movement runtime state, advanced by the shared MovementSystem exactly
    // like a character's
    this.path = [];
    this.moveProgress = 0;
    this._repathAccumulator = 0;

    this.state = 'active'; // 'active' | 'dead'
  }

  get isActive() {
    return this.state === 'active';
  }

  takeDamage(amount) {
    if (this.state === 'dead') return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.state = 'dead';
      this.aiState = 'dead';
      this.path = [];
    }
  }

  toSaveData() {
    return {
      id: this.id,
      health: this.health,
      position: { ...this.position },
      state: this.state,
      lootCollected: this.lootCollected
    };
  }
}
