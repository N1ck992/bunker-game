// SquadCombatSystem.js
// The whole party always travels together — every recruited settler's
// position gets reset to the new spawnPoint on every floor switch (see
// Game._switchLevel) — so "все герои на одном этаже" is always true for the
// active squad. What used to happen was every settler fighting (or not)
// purely on their own: only whoever already happened to be in weapon range
// auto-fired (CombatSystem), and everyone else just stood there even while
// a squadmate was getting hit two tiles away.
//
// This system watches for that moment — any enemy actually attacking an
// in-party settler — and walks the rest of the active squad into a firing
// line behind them: the settler marked as tank (Character.isTank, set from
// the roster's per-character menu — see game/ui/CharacterMenuUI.js /
// Game._setTank) takes line 1, closest to the enemy, and everyone else
// falls in behind in ascending Character.queueOrder (also set from that
// menu — see Game._setQueueOrder; unset settlers fall to the back in
// roster order), one tile further back each. Once each settler is in
// range, CombatSystem's own auto-fire takes over — this system only
// handles getting them there, once, per fight (see _engagedEnemyId).

const FRONT_STANDOFF_TILES = 1; // how close line 1 (the tank) stands to the enemy — melee range
const LINE_SPACING_TILES = 1; // gap between each subsequent line and the one in front of it

export class SquadCombatSystem {
  /** @param {MovementSystem} movementSystem */
  constructor(movementSystem) {
    this.movementSystem = movementSystem;
    this._engagedEnemyId = null; // which fight the squad is already formed up for, if any
  }

  /**
   * @param {Character[]} characters
   * @param {Enemy[]} enemies
   * @param {PathfindingSystem} pathfinder
   */
  update(characters, enemies, pathfinder) {
    const engager = this._findEngager(characters, enemies);

    if (!engager) {
      this._engagedEnemyId = null; // fight's over (or never started) — ready to trigger fresh next time
      return;
    }
    if (engager.id === this._engagedEnemyId) return; // already formed up for this one
    this._engagedEnemyId = engager.id;

    const squad = this._orderedSquad(characters);
    if (squad.length === 0) return;

    const engagedCharacter = characters.find((c) => c.id === engager.targetCharacterId) ?? squad[0];
    const row = engagedCharacter.position.row;
    const dirToEnemy = engager.position.col >= engagedCharacter.position.col ? 1 : -1;

    squad.forEach((character, i) => {
      // Already firing back — holds position, same rule MovementSystem.moveTo
      // already enforces for everyone else. Deliberately *not* skipping on
      // isBeingAttacked alone: that used to double as "already close enough"
      // back when the party's one weapon was a range-6 pistol (getting hit
      // from the mutant's attackDistance of 3 already meant well within
      // shooting range). Now every character is melee-only (range 1), so an
      // enemy attacking from 2-3 tiles away leaves them out of their own
      // swing range — skipping the walk-in here stranded them taking hits
      // forever without ever landing one back.
      if (character.combatState === 'attacking') return;

      const standoff = FRONT_STANDOFF_TILES + i * LINE_SPACING_TILES;
      const col = engager.position.col - dirToEnemy * standoff;
      this.movementSystem.moveTo(character, { col, row }, pathfinder, { allowWhileUnderFire: true });
    });
  }

  /**
   * The enemy the squad should form up against, or null if nobody's fighting.
   * Prefers whichever enemy is attacking the tank — matches the tank's whole
   * job of drawing aggro (see EnemySystem._pickTarget) — otherwise the first
   * engaged enemy found.
   */
  _findEngager(characters, enemies) {
    const party = characters.filter((c) => c.isActive && c.inParty !== false);
    if (party.length === 0) return null;
    const partyIds = new Set(party.map((c) => c.id));

    let anyEngager = null;
    for (const enemy of enemies) {
      if (!enemy.isActive || enemy.aiState !== 'attacking') continue;
      if (!partyIds.has(enemy.targetCharacterId)) continue;

      const target = party.find((c) => c.id === enemy.targetCharacterId);
      if (target?.isTank) return enemy;
      anyEngager = anyEngager ?? enemy;
    }
    return anyEngager;
  }

  /** Active in-party squad, tank first (always line 1). Everyone else is
   * sorted by their own queueOrder (see Character.queueOrder / the roster's
   * "Очередь" picker) — lower stands closer behind the tank, unset ones
   * fall to the back in roster order. */
  _orderedSquad(characters) {
    const squad = characters.filter((c) => c.isActive && c.inParty !== false);
    const tank = squad.find((c) => c.isTank);
    const rest = squad.filter((c) => c !== tank);
    const ordered = rest
      .map((c, i) => ({ c, i })) // remember original roster index for a stable tie-break
      .sort((a, b) => {
        const ao = a.c.queueOrder ?? Infinity;
        const bo = b.c.queueOrder ?? Infinity;
        return ao !== bo ? ao - bo : a.i - b.i;
      })
      .map(({ c }) => c);
    return tank ? [tank, ...ordered] : ordered;
  }
}
