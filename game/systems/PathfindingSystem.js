// PathfindingSystem.js
// Pure grid pathfinding (A*). Knows nothing about sprites, canvas or images.
// Walkable rule: cell value must be in WALKABLE_TYPES, or be an open door/ladder.

const WALKABLE_TYPES = new Set([1, 2, 3, 4]); // corridor, open door, room floor, ladder

export class PathfindingSystem {
  /**
   * @param {number[][]} grid - grid[row][col]
   * @param {Map<string, {locked:boolean,state:string}>} interactableStates - keyed "col,row"
   */
  constructor(grid, interactableStates = new Map()) {
    this.grid = grid;
    this.rows = grid.length;
    this.cols = grid[0].length;
    this.interactableStates = interactableStates;
  }

  key(col, row) {
    return `${col},${row}`;
  }

  isWalkable(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    const value = this.grid[row][col];

    // Closed doors (6) and generic walls (0), obstacles (5), rubble (7) are never walkable.
    if (!WALKABLE_TYPES.has(value)) return false;

    // A cell that hosts an interactable (door/ladder) may be dynamically locked.
    const interactable = this.interactableStates.get(this.key(col, row));
    if (interactable && interactable.locked) return false;

    return true;
  }

  neighbors(col, row) {
    const candidates = [
      [col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]
    ];
    return candidates.filter(([c, r]) => this.isWalkable(c, r));
  }

  heuristic(a, b) {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  }

  /**
   * Find a path from start to goal. Returns an array of {col,row} steps (excluding start),
   * or null if no path exists / goal is not walkable.
   */
  findPath(start, goal) {
    if (!this.isWalkable(goal.col, goal.row)) return null;
    if (start.col === goal.col && start.row === goal.row) return [];

    const startKey = this.key(start.col, start.row);
    const goalKey = this.key(goal.col, goal.row);

    const openSet = new Map();
    openSet.set(startKey, { col: start.col, row: start.row });

    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const fScore = new Map([[startKey, this.heuristic(start, goal)]]);

    const visited = new Set();

    while (openSet.size > 0) {
      // Pick lowest fScore node (fine for prototype-sized grids).
      let currentKey = null;
      let currentNode = null;
      let bestF = Infinity;
      for (const [k, node] of openSet) {
        const f = fScore.get(k) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          currentKey = k;
          currentNode = node;
        }
      }

      if (currentKey === goalKey) {
        return this._reconstructPath(cameFrom, currentKey, startKey);
      }

      openSet.delete(currentKey);
      visited.add(currentKey);

      for (const [nc, nr] of this.neighbors(currentNode.col, currentNode.row)) {
        const nKey = this.key(nc, nr);
        if (visited.has(nKey)) continue;

        const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;
        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, currentKey);
          gScore.set(nKey, tentativeG);
          fScore.set(nKey, tentativeG + this.heuristic({ col: nc, row: nr }, goal));
          if (!openSet.has(nKey)) openSet.set(nKey, { col: nc, row: nr });
        }
      }
    }

    return null; // no path found
  }

  _reconstructPath(cameFrom, currentKey, startKey) {
    const path = [];
    let key = currentKey;
    while (key !== startKey) {
      const [col, row] = key.split(',').map(Number);
      path.unshift({ col, row });
      key = cameFrom.get(key);
      if (key === undefined) return null;
    }
    return path;
  }
}
