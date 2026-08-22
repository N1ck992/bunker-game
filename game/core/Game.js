// Game.js
// Entry point. Loads JSON data, builds every system, runs the render/update loop,
// and translates taps into pathfinding / UI actions. This file intentionally
// contains the canvas rendering code (image + grid + character dots) since the
// prototype doesn't need a separate renderer module yet — everything else
// (pathfinding, resources, temperature, rooms...) lives in its own system file.

import { PathfindingSystem } from '../systems/PathfindingSystem.js';
import { MovementSystem } from '../systems/MovementSystem.js';
import { CharacterSystem } from '../systems/CharacterSystem.js';
import { RoomSystem } from '../systems/RoomSystem.js';
import { ConstructionSystem } from '../systems/ConstructionSystem.js';
import { ExpeditionSystem } from '../systems/ExpeditionSystem.js';
import { WorldSystem } from '../systems/WorldSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { CombatSystem } from '../systems/CombatSystem.js';

import { GameTime } from './GameTime.js';
import { ResourceSystem } from './ResourceSystem.js';
import { TemperatureSystem } from './TemperatureSystem.js';
import { SaveSystem } from './SaveSystem.js';

import { Character } from '../entities/Character.js';
import { Room } from '../entities/Room.js';
import { Enemy } from '../entities/Enemy.js';
import { Item } from '../entities/Item.js';
import { EnemySystem } from '../systems/EnemySystem.js';

import { ShelterUI } from '../ui/ShelterUI.js';
import { CharacterUI } from '../ui/CharacterUI.js';
import { ConstructionUI } from '../ui/ConstructionUI.js';
import { WorldMapUI } from '../ui/WorldMapUI.js';
import { CharacterRosterUI } from '../ui/CharacterRosterUI.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { EnemyMenuUI } from '../ui/EnemyMenuUI.js';
import { EnemyInfoUI } from '../ui/EnemyInfoUI.js';
import { showStartMenu } from '../ui/StartMenu.js';

const DEBUG_GRID = false; // flip to true to see the passability grid over the art
const CHARACTER_HEIGHT_TILES = 6.2; // sprite height in grid cells — was 3.6, bumped up per feedback. Рост героев.
const RESOURCE_LABELS = { food: 'еды', water: 'воды', heat: 'тепла', materials: 'материалов' };

class Game {
  async init() {
    const [balance, mapData, roomsData, charactersData, itemsData] = await Promise.all([
      fetchJson('game/data/balance.json'),
      fetchJson('game/map/bunker-map.json'),
      fetchJson('game/data/rooms.json'),
      fetchJson('game/data/characters.json'),
      fetchJson('game/data/items.json')
    ]);

    this.balance = balance;
    this.mapData = mapData;
    this.itemsById = new Map(itemsData.items.map((i) => [i.id, new Item(i)]));

    const save = new SaveSystem().load();
    this.saveSystem = new SaveSystem();

    this.rooms = roomsData.rooms.map((r) => new Room(r));
    this.characters = charactersData.characters.map((c) => new Character(c));
    this.enemies = await this._loadEnemies(mapData);

    if (save) this._applySave(save);

    // Interactable states (doors/ladders) keyed by "col,row" for the pathfinder.
    this.interactableStates = new Map();
    for (const it of this.mapData.interactables) {
      this.interactableStates.set(`${it.col},${it.row}`, it);
    }
    if (save?.interactables) {
      for (const it of this.mapData.interactables) {
        const saved = save.interactables.find((s) => s.id === it.id);
        if (saved) Object.assign(it, saved);
      }
    }

    this.pathfinder = new PathfindingSystem(this.mapData.grid, this.interactableStates);
    this._sanitizeCharacterPositions();

    // Furniture (table/wardrobe/etc.) that's currently being "worked" for a
    // slow trickle of resources. Keyed by interactable id. See
    // _onFurnitureTapped / _updateFurnitureInteractions.
    this.activeFurnitureInteractions = new Map();

    // Characters currently walking toward a furniture object they tapped,
    // keyed by character id -> interactable id. Once they arrive at the
    // object's column, _updatePendingFurnitureInteractions starts the
    // actual gather session.
    this.pendingFurnitureInteractions = new Map();

    this.movementSystem = new MovementSystem(balance);
    this.characterSystem = new CharacterSystem(balance);
    this.roomSystem = new RoomSystem(this.rooms);
    this.resourceSystem = new ResourceSystem(balance, save?.resources);
    this.temperatureSystem = new TemperatureSystem(balance);
    this.constructionSystem = new ConstructionSystem(this.resourceSystem, this.roomSystem);
    this.expeditionSystem = new ExpeditionSystem();
    this.worldSystem = new WorldSystem();
    this.gameTime = new GameTime(balance, save?.gameTime);
    this.enemySystem = new EnemySystem(this.pathfinder, this.movementSystem, (enemy, target) => {
      this._toast(`${enemy.name} атакует ${target.name}!`);
    });
    this.inventorySystem = new InventorySystem(this.itemsById);
    this.combatSystem = new CombatSystem(
      this.itemsById,
      (character, enemy) => this._toast(`${character.name} открывает огонь по цели: ${enemy.name}!`),
      (character, enemy) => {
        this._attackEffects.push({
          from: { ...character.position },
          to: { ...enemy.position },
          start: this._now ?? performance.now()
        });
      }
    );
    this._attackEffects = []; // transient tracer effects for ranged hits, see _renderAttackEffects

    this._buildDom();
    this._loadBunkerImage();
    this._loadCharacterSprites();
    this._loadEnemySprites();
    this._bindInput();

    // Auto-select the player's only character so its panel is one tap away,
    // and so movement/facing has something sensible to start from.
    if (this.characters[0]) {
      this.characterSystem.select(this.characters[0].id);
      this.characters[0].facingDir = 1;
    }

    this._needsTickAccumulator = 0;
    this._resourceTickAccumulator = 0;
    this._lastFrameTime = performance.now();

    requestAnimationFrame((t) => this._loop(t));

    // autosave every 20s
    setInterval(() => this._save(), 20000);
  }

  _applySave(save) {
    if (save.characters) {
      // Merge, don't replace: for each character defined in the current
      // characters.json, use the saved version if one exists (keeps health/
      // position/etc. between sessions) — but a character that's only in
      // characters.json (freshly added, no save entry yet) keeps its default
      // spawn data instead of vanishing. This is what was silently dropping
      // newly-added roster members before.
      const savedById = new Map(save.characters.map((c) => [c.id, c]));
      this.characters = this.characters.map((defaultChar) => {
        const saved = savedById.get(defaultChar.id);
        return saved ? new Character(saved) : defaultChar;
      });
    }
    if (save.rooms) {
      this.rooms = save.rooms.map((r) => new Room(r));
    }
    if (save.enemies) {
      const savedById = new Map(save.enemies.map((e) => [e.id, e]));
      for (const enemy of this.enemies) {
        const saved = savedById.get(enemy.id);
        if (!saved) continue;
        enemy.health = saved.health;
        enemy.position = { ...saved.position };
        enemy.state = saved.state;
        if (enemy.state === 'dead') enemy.aiState = 'dead';
      }
    }
  }

  /**
   * Loads every enemy race listed in game/data/enemies/index.json, then
   * builds one Enemy instance per spawn entry in the map's "enemies" array.
   * Adding a new race/unit never touches this method — see
   * game/data/enemies/README.md.
   */
  async _loadEnemies(mapData) {
    const spawns = mapData.enemies ?? [];
    if (spawns.length === 0) return [];

    const index = await fetchJson('game/data/enemies/index.json');
    const raceFiles = await Promise.all(
      index.races.map((raceId) => fetchJson(`game/data/enemies/${raceId}.json`))
    );

    const unitDefsByKey = new Map();
    for (const race of raceFiles) {
      for (const unit of race.units) {
        unitDefsByKey.set(`${race.id}:${unit.id}`, unit);
      }
    }
    this.enemyUnitDefsByKey = unitDefsByKey;

    const enemies = [];
    for (const spawn of spawns) {
      const unitDef = unitDefsByKey.get(`${spawn.raceId}:${spawn.unitId}`);
      if (!unitDef) {
        console.error(`[Game] Unknown enemy ${spawn.raceId}:${spawn.unitId} for spawn "${spawn.id}" — skipping.`);
        continue;
      }
      enemies.push(new Enemy(spawn, unitDef));
    }
    return enemies;
  }

  /**
   * Snaps any character standing on a tile that isn't walkable in the
   * *current* map back to the map's spawn point. Guards against exactly the
   * "flying outside the bunker" bug: a saved position from an older map
   * layout landing on what is now empty scenery (or off-grid entirely).
   *
   * Also snaps if the character's row doesn't match the spawn row: movement
   * is horizontal-only right now, so exactly one row is the "real" floor
   * line and a character saved on any other row (e.g. from before the floor
   * row was corrected) would otherwise stay stuck floating there forever.
   */
  _sanitizeCharacterPositions() {
    const spawn = this.mapData.spawnPoint;
    for (const character of this.characters) {
      const onWrongRow = character.position.row !== spawn.row;
      if (onWrongRow || !this.pathfinder.isWalkable(character.position.col, character.position.row)) {
        character.position = { ...spawn };
        character.path = [];
        character.moveProgress = 0;
      }
    }
  }

  _buildDom() {
    const app = document.getElementById('app');

    this.sceneWrap = document.createElement('div');
    this.sceneWrap.className = 'scene-wrap';

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sceneWrap.appendChild(this.canvas);
    app.appendChild(this.sceneWrap);

    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'ui-root';
    app.appendChild(this.uiRoot);

    this.rosterUI = new CharacterRosterUI(this.uiRoot, {
      onSelect: (characterId) => {
        const character = this.characters.find((c) => c.id === characterId);
        if (character) this._selectCharacter(character);
      }
    });

    this.shelterUI = new ShelterUI(this.uiRoot, {
      onConstruction: () => this._toast('Выберите дверь на карте, чтобы открыть новое помещение.'),
      onCharacters: () => this._toast('Нажмите на жителя, чтобы увидеть его состояние.'),
      onExpedition: () => this._toast('Экспедиции появятся после открытия выхода на поверхность.'),
      onMap: () => this.worldMapUI.show()
    });
    this.characterUI = new CharacterUI(this.uiRoot);
    this.constructionUI = new ConstructionUI(this.uiRoot);
    this.worldMapUI = new WorldMapUI(this.uiRoot);
    this.inventoryUI = new InventoryUI(this.uiRoot);
    this.enemyMenuUI = new EnemyMenuUI(this.uiRoot);
    this.enemyInfoUI = new EnemyInfoUI(this.uiRoot);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast hidden';
    this.uiRoot.appendChild(this.toastEl);

    window.addEventListener('resize', () => this._resizeCanvas());
  }

  _loadCharacterSprites() {
    // One sprite per animation state, per spec section 25 — placeholders now,
    // swappable for a full sheet later without touching call sites.
    this.sprites = {
      idle: makeImage('game/assets/characters/char_idle.png'),
      examine: makeImage('game/assets/characters/char_examine.png'),
      run: [
        makeImage('game/assets/characters/char_run_0.png'),
        makeImage('game/assets/characters/char_run_1.png'),
        makeImage('game/assets/characters/char_run_2.png')
      ],
      // Draw → aim → fire ×4 → recover, 11 frames — cycled while
      // character.combatState === 'attacking' (set by CombatSystem).
      attack: [
        makeImage('game/assets/characters/char_attack_0.png'),
        makeImage('game/assets/characters/char_attack_1.png'),
        makeImage('game/assets/characters/char_attack_2.png'),
        makeImage('game/assets/characters/char_attack_3.png'),
        makeImage('game/assets/characters/char_attack_4.png'),
        makeImage('game/assets/characters/char_attack_5.png'),
        makeImage('game/assets/characters/char_attack_6.png'),
        makeImage('game/assets/characters/char_attack_7.png'),
        makeImage('game/assets/characters/char_attack_8.png'),
        makeImage('game/assets/characters/char_attack_9.png'),
        makeImage('game/assets/characters/char_attack_10.png')
      ]
    };
  }

  /**
   * One sprite set per race+unit type (not per enemy instance) — several
   * raider_grunts on the same map share these Image objects instead of each
   * loading their own copy. Missing files (art not delivered yet) just leave
   * naturalWidth at 0; _renderEnemies falls back to a placeholder shape so
   * AI/combat is testable before art exists.
   */
  _loadEnemySprites() {
    this.enemySprites = new Map();
    for (const enemy of this.enemies) {
      const key = `${enemy.raceId}:${enemy.unitId}`;
      if (this.enemySprites.has(key)) continue;

      const unitDef = this.enemyUnitDefsByKey.get(key);
      const { idle, run, attack } = unitDef.sprites;
      // idle can be one static path or an array of frames to cycle through
      // (afk animation) — same convention as run/attack. Kept both forms
      // working so races that only have a single idle pose don't need a
      // pointless one-element array in their JSON.
      this.enemySprites.set(key, {
        idle: Array.isArray(idle) ? idle.map(makeImage) : [makeImage(idle)],
        run: run.map(makeImage),
        attack: attack.map(makeImage)
      });
    }
  }

  _loadBunkerImage() {
    this.bunkerImage = new Image();
    this.bunkerImage.onload = () => this._resizeCanvas();
    this.bunkerImage.onerror = () => {
      console.error(`[Game] Не удалось загрузить изображение бункера: ${this.mapData.image}`);
      this._toast('Не удалось загрузить картинку бункера — карта всё ещё работает.');
    };
    this.bunkerImage.src = this.mapData.image;

    // Size the canvas immediately from the known imageSize in the map data,
    // instead of waiting on the image to load — so the grid/characters render
    // even if the image is slow or fails.
    this._resizeCanvas();
  }

  // "Contain" fit: the whole scene (surface + bunker) always fits inside the
  // available box, letterboxed if needed, instead of being cropped by a fixed
  // aspect-ratio canvas. This matters a lot now that the full tall artwork
  // (wasteland + vault door + interior) is used instead of just the interior crop.
  _resizeCanvas() {
    const boxWidth = this.sceneWrap.clientWidth;
    const boxHeight = this.sceneWrap.clientHeight;
    const { width: imgW, height: imgH } = this.mapData.imageSize;

    this.canvas.width = boxWidth;
    this.canvas.height = boxHeight;

    this.scale = Math.min(boxWidth / imgW, boxHeight / imgH);
    this.offsetX = (boxWidth - imgW * this.scale) / 2;
    this.offsetY = (boxHeight - imgH * this.scale) / 2;
  }

  _bindInput() {
    this.canvas.addEventListener('pointerdown', (e) => this._onTap(e));
  }

  _onTap(e) {
    // Any tap on the map dismisses the enemy mini-menu, whether or not it
    // hits a new enemy right after — it isn't a full-screen overlay like the
    // other modals, so it doesn't swallow the tap itself.
    this.enemyMenuUI.hide();

    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left - this.offsetX) / this.scale;
    const py = (e.clientY - rect.top - this.offsetY) / this.scale;

    const cellSize = this.mapData.cellSize;
    const col = Math.floor(px / cellSize);
    const row = Math.floor(py / cellSize);

    // 1) Tapped a character?
    const tappedCharacter = this.characters.find(
      (c) => c.position.col === col && c.position.row === row
    );
    if (tappedCharacter) {
      this._selectCharacter(tappedCharacter);
      return;
    }

    // 2) Tapped an (active) enemy? Open the Изучить/Атаковать mini-menu
    // instead of walking straight there — that used to send the hero right
    // onto the enemy's own tile. Hit area is deliberately much bigger than
    // its single grid tile (see _enemyHitBounds) so it's easy to tap.
    const tappedEnemy = this.enemies.find((en) => {
      if (!en.isActive) return false;
      const box = this._enemyHitBounds(en);
      return px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
    });
    if (tappedEnemy) {
      this._onEnemyTapped(tappedEnemy, e);
      return;
    }

    // 3) Tapped an interactable (door/ladder/furniture)?
    const interactable = this.interactableStates.get(`${col},${row}`);
    if (interactable) {
      if (interactable.type === 'furniture') {
        this._onFurnitureTapped(interactable);
      } else {
        this._onInteractableTapped(interactable);
      }
      return;
    }

    // 4) Otherwise, move the selected character there. Movement is
    // horizontal-only, so we ignore the tapped row and keep the character's
    // current one — tapping anywhere in the room just walks them left/right
    // toward that column.
    const selected = this.characterSystem.getSelected(this.characters);
    if (selected) {
      this.pendingFurnitureInteractions.delete(selected.id);
      const target = { col, row: selected.position.row };
      const moved = this.movementSystem.moveTo(selected, target, this.pathfinder);
      if (!moved) this._toast('Туда пройти нельзя.');
    }
  }

  _selectCharacter(character) {
    this.characterSystem.select(character.id);
    this._showCharacterPanel(character);
  }

  _showCharacterPanel(character) {
    this.characterUI.show(
      character,
      this.rooms,
      (roomId) => {
        if (roomId) this.roomSystem.assignWorker(roomId, character.id, this.characters);
        else this.roomSystem.unassignWorker(character.id, this.characters);
      },
      () => this.characterSystem.deselect(),
      (c) => this._openInventory(c),
      this.itemsById
    );
  }

  _openInventory(character) {
    this.inventoryUI.show(
      character,
      this.inventorySystem,
      (itemId) => {
        this.inventorySystem.equip(character, itemId);
        this._openInventory(character); // refresh the modal in place
        this._showCharacterPanel(character); // keep the panel underneath in sync (gear row)
      },
      (slot) => {
        this.inventorySystem.unequip(character, slot);
        this._openInventory(character);
        this._showCharacterPanel(character);
      },
      () => {}
    );
  }

  /**
   * Tap hit-box for an enemy, deliberately much larger than its single grid
   * tile so it's easy to hit on a phone screen. Returned in the same
   * unscaled image-space pixels as _onTap's px/py (i.e. divide out
   * this.scale), so callers can compare directly.
   *
   * Width: as wide as the enemy's own rendered sprite image (same drawW
   * math as _renderEnemies), not just its one grid column.
   * Height: from the floor tile it's standing on up to the ceiling of this
   * room — the contiguous run of walkable tiles above it in the same column
   * — instead of just its own row, since the room art is much taller than a
   * single tile.
   */
  _enemyHitBounds(enemy) {
    const cellSize = this.mapData.cellSize;

    const spriteSet = this.enemySprites.get(`${enemy.raceId}:${enemy.unitId}`);
    const idleSprite = spriteSet?.idle?.[0];
    const drawH = cellSize * CHARACTER_HEIGHT_TILES;
    const hasSprite = idleSprite && idleSprite.complete && idleSprite.naturalWidth > 0;
    const drawW = hasSprite ? drawH * (idleSprite.naturalWidth / idleSprite.naturalHeight) : drawH * 0.32;

    const centerX = (enemy.position.col + 0.5) * cellSize;

    let ceilingRow = enemy.position.row;
    while (ceilingRow > 0 && this.pathfinder.isWalkable(enemy.position.col, ceilingRow - 1)) {
      ceilingRow--;
    }

    return {
      left: centerX - drawW / 2,
      right: centerX + drawW / 2,
      top: ceilingRow * cellSize,
      bottom: (enemy.position.row + 1) * cellSize
    };
  }

  _onEnemyTapped(enemy, e) {
    this.enemyMenuUI.show(enemy, e.clientX, e.clientY, {
      onExamine: () => this._examineEnemy(enemy),
      onAttack: () => this._commandAttack(enemy)
    });
  }

  /** "Изучить" — a look-don't-touch inspection, so the hero never moves for this. */
  _examineEnemy(enemy) {
    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (character) {
      character.animState = 'examine';
      character.facingDir = enemy.position.col >= character.position.col ? 1 : -1;
      clearTimeout(this._examineTimer);
      this._examineTimer = setTimeout(() => {
        character.animState = 'idle';
      }, 1800);
    }

    this.enemyInfoUI.show(enemy, () => {});
  }

  /**
   * "Атаковать" — walks the selected character to just inside their
   * equipped weapon's range (never onto the enemy's own tile), then stops.
   * Once there the path is empty, so the hero simply stands and faces the
   * target while CombatSystem's per-frame auto-fire does the rest — the
   * hero never chases past that point.
   */
  _commandAttack(enemy) {
    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (!character || !character.isActive) return;

    const weapon = character.weapon ? this.itemsById.get(character.weapon) : null;
    if (!weapon || weapon.slot !== 'weapon') {
      this._toast(`${character.name}: нет оружия для атаки.`);
      return;
    }

    const dirToEnemy = enemy.position.col >= character.position.col ? 1 : -1;
    const distance = Math.hypot(
      enemy.position.col - character.position.col,
      enemy.position.row - character.position.row
    );

    if (distance <= weapon.range) {
      // Already in range — just turn to face the target and hold position.
      character.facingDir = dirToEnemy;
      return;
    }

    this.pendingFurnitureInteractions.delete(character.id);

    const standoffDistance = Math.max(1, weapon.range - 1);
    const desiredCol = enemy.position.col - dirToEnemy * standoffDistance;
    const target = { col: desiredCol, row: character.position.row };

    let moved = this.movementSystem.moveTo(character, target, this.pathfinder);
    if (!moved) {
      // Standoff tile blocked (e.g. a wall) — fall back to one tile short of
      // the enemy's own column instead, so the hero still doesn't end up
      // standing on top of it.
      const fallbackCol = enemy.position.col - dirToEnemy;
      moved = this.movementSystem.moveTo(character, { col: fallbackCol, row: character.position.row }, this.pathfinder);
    }
    if (!moved) this._toast('Туда пройти нельзя.');
  }

  _onInteractableTapped(interactable) {
    // Brief "examining" animation while the info/unlock modal is open.
    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (character) {
      character.animState = 'examine';
      clearTimeout(this._examineTimer);
      this._examineTimer = setTimeout(() => {
        character.animState = 'idle';
      }, 1800);
    }

    const linkedRoom =
      interactable.leadsTo && interactable.leadsTo !== 'surface'
        ? this.rooms.find((r) => r.id === interactable.leadsTo)
        : null;

    this.constructionUI.showLockedInfo(
      interactable,
      linkedRoom,
      this.resourceSystem,
      () => {
        const result = this.constructionSystem.tryUnlock(interactable, linkedRoom);
        if (result.ok) {
          this._toast(`Открыто: ${interactable.label}`);
          this.constructionUI.hide();
        } else if (result.reason === 'insufficient_resources') {
          this._toast('Недостаточно материалов.');
        } else if (result.reason === 'not_available_yet') {
          this._toast('Пока недоступно.');
        }
      },
      () => {}
    );
  }

  /**
   * Tapping furniture no longer starts gathering on the spot — the character
   * has to walk over to it first (movement is horizontal-only, so "over" means
   * lining up on the object's column, on whatever row the character is
   * already standing on). Once they arrive, _updatePendingFurnitureInteractions
   * kicks off the actual gather session via _startFurnitureGather.
   */
  _onFurnitureTapped(interactable) {
    const now = this._now ?? performance.now();

    if (interactable.cooldownUntil && now < interactable.cooldownUntil) {
      const secondsLeft = Math.ceil((interactable.cooldownUntil - now) / 1000);
      this._toast(`${interactable.label}: нужно подождать ещё ${secondsLeft} сек.`);
      return;
    }
    if (this.activeFurnitureInteractions.has(interactable.id)) return;

    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (!character) return;

    const alreadyBusy = [...this.activeFurnitureInteractions.values()].some(
      (session) => session.character === character
    );
    if (alreadyBusy) {
      this._toast('Сначала закончи текущее дело.');
      return;
    }

    if (character.position.col === interactable.col) {
      this._startFurnitureGather(interactable, character);
      return;
    }

    const target = { col: interactable.col, row: character.position.row };
    const moved = this.movementSystem.moveTo(character, target, this.pathfinder);
    if (moved) {
      this.pendingFurnitureInteractions.set(character.id, interactable.id);
    } else {
      this._toast('Туда пройти нельзя.');
    }
  }

  _updatePendingFurnitureInteractions() {
    for (const [characterId, interactableId] of this.pendingFurnitureInteractions) {
      const character = this.characters.find((c) => c.id === characterId);
      const interactable = this.mapData.interactables.find((it) => it.id === interactableId);

      if (!character || !interactable || !character.isActive) {
        this.pendingFurnitureInteractions.delete(characterId);
        continue;
      }
      if (character.path.length > 0) continue; // still walking there

      this.pendingFurnitureInteractions.delete(characterId);
      // Arrived on the right column and the object is still free (didn't go
      // on cooldown from another character while this one was walking)?
      if (
        character.position.col === interactable.col &&
        !this.activeFurnitureInteractions.has(interactable.id) &&
        !(interactable.cooldownUntil && (this._now ?? performance.now()) < interactable.cooldownUntil)
      ) {
        this._startFurnitureGather(interactable, character);
      }
    }
  }

  _startFurnitureGather(interactable, character) {
    const now = this._now ?? performance.now();
    const { durationSeconds, cooldownSeconds } = interactable.interaction;
    interactable.activeUntil = now + durationSeconds * 1000;
    interactable.cooldownUntil = interactable.activeUntil + cooldownSeconds * 1000;
    this.activeFurnitureInteractions.set(interactable.id, { interactable, character, gained: {} });

    character.animState = 'examine';
    character.facingDir = interactable.col >= character.position.col ? 1 : -1;

    this._toast(`${interactable.label}: идёт сбор ресурсов...`);
  }

  _updateFurnitureInteractions(dt) {
    const now = this._now ?? performance.now();

    for (const [id, session] of this.activeFurnitureInteractions) {
      const { interactable } = session;
      const isDone = now >= interactable.activeUntil;
      const tickSeconds = isDone
        ? Math.max(0, dt - (now - interactable.activeUntil) / 1000)
        : dt;

      if (tickSeconds > 0) {
        const amounts = {};
        for (const [res, perSecond] of Object.entries(interactable.interaction.produces)) {
          const amount = perSecond * tickSeconds;
          amounts[res] = amount;
          session.gained[res] = (session.gained[res] ?? 0) + amount;
        }
        this.resourceSystem.gain(amounts);
      }

      if (isDone) {
        this.activeFurnitureInteractions.delete(id);
        if (session.character.animState === 'examine') session.character.animState = 'idle';

        const summary = Object.entries(session.gained)
          .map(([res, amount]) => `+${amount.toFixed(1)} ${RESOURCE_LABELS[res] ?? res}`)
          .join(', ');
        this._toast(`${interactable.label}: получено ${summary}`);
      }
    }
  }

  _toast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), 2200);
  }

  _loop(now) {
    const dt = Math.min(0.1, (now - this._lastFrameTime) / 1000);
    this._lastFrameTime = now;
    this._now = now;

    this._update(dt);
    this._render();

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt) {
    this.gameTime.update(dt);
    this.movementSystem.update(this.characters, dt);
    this.enemySystem.update(this.enemies, this.characters, dt);
    this.movementSystem.update(this.enemies, dt);
    this.combatSystem.update(this.characters, this.enemies, dt);
    this._updatePendingFurnitureInteractions();
    this._updateFurnitureInteractions(dt);

    // needs/resource ticks run on their own slower cadence
    this._needsTickAccumulator += dt * 1000;
    if (this._needsTickAccumulator >= 4000) {
      this._needsTickAccumulator = 0;
      this.characterSystem.applyNeedsTick(this.characters, this.temperatureSystem);
    }

    this._resourceTickAccumulator += dt * 1000;
    if (this._resourceTickAccumulator >= this.balance.resources.tickIntervalMs) {
      this._resourceTickAccumulator = 0;
      const production = this.roomSystem.totalProduction();
      const activeCount = this.characters.filter((c) => c.isActive).length;
      const delta = this.resourceSystem.applyTick(production, activeCount);
      if (this.resourceSystem.food <= 5) this.shelterUI.flashLowResource('food');
      if (this.resourceSystem.water <= 5) this.shelterUI.flashLowResource('water');
    }

    this.shelterUI.update(this.resourceSystem, this.gameTime);
    this.rosterUI.update(this.characters, this.characterSystem.selectedId);
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const { width: imgW, height: imgH } = this.mapData.imageSize;
    const drawW = imgW * this.scale;
    const drawH = imgH * this.scale;

    if (this.bunkerImage.complete && this.bunkerImage.naturalWidth > 0) {
      ctx.drawImage(this.bunkerImage, this.offsetX, this.offsetY, drawW, drawH);
    }

    // Night darkening overlay tied to GameTime, cheap but sells the day/night loop.
    if (!this.gameTime.isDay) {
      ctx.fillStyle = 'rgba(5,5,20,0.35)';
      ctx.fillRect(this.offsetX, this.offsetY, drawW, drawH);
    }

    // Everything below is authored in image-space; translate once so every
    // draw call can keep using col/row * cellSize * scale like before.
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);

    if (DEBUG_GRID) this._renderDebugGrid();

    this._renderSurfaceLabel();
    this._renderInteractables();
    this._renderEnemies();
    this._renderCharacters();
    this._renderAttackEffects();

    ctx.restore();
  }

  _renderSurfaceLabel() {
    // Purely cosmetic: labels the vault door visible at the top of the full
    // artwork so it reads as "there, but locked" rather than dead space.
    // Coordinates are in image-space (imgW/imgH), scaled like everything else
    // drawn after the translate() in _render.
    const ctx = this.ctx;
    const { width: imgW, height: imgH } = this.mapData.imageSize;
    ctx.save();
    ctx.font = `${Math.max(11, 13 * this.scale)}px monospace`;
    ctx.fillStyle = 'rgba(232,176,75,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(
      'ВЫХОД НА ПОВЕРХНОСТЬ (заблокировано)',
      imgW * this.scale * 0.72,
      imgH * this.scale * 0.14
    );
    ctx.restore();
  }

  _renderDebugGrid() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    ctx.strokeStyle = 'rgba(0,255,140,0.25)';
    for (let row = 0; row < this.mapData.rows; row++) {
      for (let col = 0; col < this.mapData.cols; col++) {
        const v = this.mapData.grid[row][col];
        if (v === 0) continue;
        ctx.strokeRect(col * cs, row * cs, cs, cs);
      }
    }
  }

  _renderInteractables() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    const now = this._now ?? performance.now();

    for (const it of this.mapData.interactables) {
      const x = it.col * cs;
      const y = it.row * cs;

      if (it.type === 'furniture') {
        // The furniture is already drawn into the background art, so this is
        // just a small breathing dot: green = ready, amber ring filling up =
        // gathering in progress, dim red = on cooldown. No dashed rectangle —
        // that reads as "locked door", which this isn't.
        const cx = x + cs / 2;
        const cy = y + cs / 2;
        const isActive = this.activeFurnitureInteractions.has(it.id);
        const onCooldown = !isActive && it.cooldownUntil && now < it.cooldownUntil;

        ctx.save();
        if (isActive) {
          const { durationSeconds } = it.interaction;
          const progress = 1 - Math.max(0, (it.activeUntil - now) / (durationSeconds * 1000));
          ctx.strokeStyle = '#e8b04b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, cs * 0.3, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = onCooldown ? 'rgba(192,57,43,0.55)' : 'rgba(46,204,113,0.75)';
          ctx.beginPath();
          ctx.arc(cx, cy, cs * 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }

      const spanRows = it.type === 'ladder' ? 8 : 1;
      ctx.save();
      ctx.strokeStyle = it.locked ? '#c0392b' : '#2ecc71';
      ctx.lineWidth = 3;
      ctx.setLineDash(it.type === 'ladder' ? [6, 4] : []);
      ctx.strokeRect(x, y, cs, cs * spanRows);
      ctx.restore();
    }
  }

  /**
   * Renders every enemy using its race+unit sprite set (see
   * _loadEnemySprites). Falls back to a plain silhouette when the art files
   * aren't there yet, so aggro/attack behaviour is testable before assets
   * exist — swap in real PNGs later and this needs no changes.
   */
  _renderEnemies() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;

    for (const enemy of this.enemies) {
      if (enemy.state === 'dead') continue;

      let px, py;
      if (enemy.path && enemy.path.length > 0) {
        const next = enemy.path[0];
        px = lerp(enemy.position.col, next.col, enemy.moveProgress);
        py = lerp(enemy.position.row, next.row, enemy.moveProgress);
      } else {
        px = enemy.position.col;
        py = enemy.position.row;
      }

      const x = (px + 0.5) * cs;
      const groundY = (py + 1) * cs;
      const drawH = cs * CHARACTER_HEIGHT_TILES;

      const spriteSet = this.enemySprites.get(`${enemy.raceId}:${enemy.unitId}`);
      let sprite;
      if (enemy.aiState === 'attacking') {
        sprite = this._cycleFrame(spriteSet.attack, 8);
      } else if (enemy.aiState === 'chasing') {
        sprite = this._cycleFrame(spriteSet.run, 7);
      } else {
        // Slower cadence than run/attack — this is idle "breathing"/afk
        // fidgeting, not fast action, so it shouldn't read as jittery.
        sprite = this._cycleFrame(spriteSet.idle, 4);
      }
      const hasSprite = sprite.complete && sprite.naturalWidth > 0;
      const drawW = hasSprite ? drawH * (sprite.naturalWidth / sprite.naturalHeight) : drawH * 0.32;

      ctx.save();

      // Reddish ground glow (vs. the characters' warm one) so enemies read
      // as hostile at a glance even before real art is in place.
      ctx.beginPath();
      ctx.ellipse(x, groundY - 2, drawW * 0.5, cs * 0.28, 0, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(x, groundY, 0, x, groundY, drawW * 0.6);
      glow.addColorStop(0, 'rgba(220,60,60,0.35)');
      glow.addColorStop(1, 'rgba(220,60,60,0)');
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.translate(x, groundY - drawH);
      if (enemy.facingDir < 0) ctx.scale(-1, 1);

      if (hasSprite) {
        ctx.drawImage(sprite, -drawW / 2, 0, drawW, drawH);
      } else {
        // Placeholder: a simple silhouette so the enemy is visible/testable
        // before its animations are delivered.
        ctx.fillStyle = enemy.aiState === 'attacking' ? '#8b2e2e' : '#5a2e2e';
        ctx.beginPath();
        ctx.ellipse(0, drawH * 0.18, drawW * 0.22, drawH * 0.18, 0, 0, Math.PI * 2); // head
        ctx.fill();
        ctx.fillRect(-drawW * 0.18, drawH * 0.32, drawW * 0.36, drawH * 0.6); // body
      }

      ctx.restore();

      // Name + health bar above the enemy, mirroring the character name label.
      ctx.save();
      ctx.font = `bold ${Math.max(11, 12 * this.scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#2b0d0d';
      ctx.fillText(enemy.name, x, groundY - drawH - 6 + 1);
      ctx.fillStyle = '#ffb3b3';
      ctx.fillText(enemy.name, x, groundY - drawH - 6);

      const barW = cs * 1.2;
      const barY = groundY - drawH - 16;
      const healthRatio = enemy.health / enemy.maxHealth;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - barW / 2, barY, barW, 4);
      ctx.fillStyle = healthRatio > 0.3 ? '#c0392b' : '#e74c3c';
      ctx.fillRect(x - barW / 2, barY, barW * healthRatio, 4);
      ctx.restore();
    }
  }

  _cycleFrame(frames, fps) {
    const frameIndex = Math.floor((this._now / 1000) * fps) % frames.length;
    return frames[frameIndex];
  }

  _renderCharacters() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;

    for (const character of this.characters) {
      let px, py;
      if (character.path && character.path.length > 0) {
        const next = character.path[0];
        const t = character.moveProgress;
        px = lerp(character.position.col, next.col, t);
        py = lerp(character.position.row, next.row, t);
      } else {
        px = character.position.col;
        py = character.position.row;
      }

      const x = (px + 0.5) * cs;
      const groundY = (py + 1) * cs; // sprite's feet rest on the tile's bottom edge

      const isMoving = character.path && character.path.length > 0;
      let sprite;
      if (isMoving) {
        // Moving always wins — a character walking into range cancels any
        // stale "attacking" pose from the previous target, same as examine.
        const RUN_FPS = 7;
        const frameIndex = Math.floor((this._now / 1000) * RUN_FPS) % this.sprites.run.length;
        sprite = this.sprites.run[frameIndex];
      } else if (character.combatState === 'attacking') {
        const ATTACK_FPS = 10;
        const frameIndex = Math.floor((this._now / 1000) * ATTACK_FPS) % this.sprites.attack.length;
        sprite = this.sprites.attack[frameIndex];
      } else if (character.animState === 'examine') {
        sprite = this.sprites.examine;
      } else {
        sprite = this.sprites.idle;
      }
      const drawH = cs * CHARACTER_HEIGHT_TILES;
      const drawW = sprite.naturalWidth
        ? drawH * (sprite.naturalWidth / sprite.naturalHeight)
        : drawH * 0.32;

      ctx.save();

      // Soft ground glow so the sprite doesn't get lost in the dark floor art.
      ctx.beginPath();
      ctx.ellipse(x, groundY - 2, drawW * 0.5, cs * 0.28, 0, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(x, groundY, 0, x, groundY, drawW * 0.6);
      glow.addColorStop(0, 'rgba(255,220,120,0.35)');
      glow.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = glow;
      ctx.fill();

      if (sprite.complete && sprite.naturalWidth > 0) {
        ctx.translate(x, groundY - drawH);
        if (character.facingDir < 0) ctx.scale(-1, 1);
        if (!character.isActive) ctx.globalAlpha = 0.5;
        ctx.drawImage(sprite, -drawW / 2, 0, drawW, drawH);
      }

      ctx.restore();

      // Name label above the character, always on, so it's easy to spot at a glance.
      ctx.save();
      ctx.font = `bold ${Math.max(11, 12 * this.scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0b0d0a';
      ctx.fillText(character.name, x, groundY - drawH - 6 + 1);
      ctx.fillStyle = '#ffe9b3';
      ctx.fillText(character.name, x, groundY - drawH - 6);
      ctx.restore();
    }
  }

  /**
   * Ranged weapons have no art yet, so a shot is represented as a short-lived
   * tracer line (character -> target) instead of a projectile sprite. Effects
   * are pushed by CombatSystem's onAttack callback and pruned here once their
   * lifetime elapses — nothing else references this.attackEffects.
   */
  _renderAttackEffects() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    const LIFETIME_MS = 140;
    const now = this._now ?? performance.now();

    this._attackEffects = this._attackEffects.filter((fx) => now - fx.start < LIFETIME_MS);

    for (const fx of this._attackEffects) {
      const t = (now - fx.start) / LIFETIME_MS;
      const fromX = (fx.from.col + 0.5) * cs;
      const fromY = (fx.from.row + 0.5) * cs - cs * 3; // roughly chest height, not feet
      const toX = (fx.to.col + 0.5) * cs;
      const toY = (fx.to.row + 0.5) * cs - cs * 2;

      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#fff2b3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();

      ctx.fillStyle = '#fff2b3';
      ctx.beginPath();
      ctx.arc(toX, toY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _save() {
    this.saveSystem.save({
      characters: this.characters.map((c) => c.toSaveData()),
      rooms: this.rooms.map((r) => r.toSaveData()),
      enemies: this.enemies.map((e) => e.toSaveData()),
      resources: this.resourceSystem.toSaveData(),
      gameTime: this.gameTime.toSaveData(),
      interactables: this.mapData.interactables.map((it) => ({ id: it.id, locked: it.locked, state: it.state }))
    });
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

showStartMenu(() => {
  const game = new Game();
  game.init().catch((err) => {
    console.error(err);
    document.getElementById('app').innerHTML =
      `<div style="color:#f66;padding:20px;font-family:monospace;">Ошибка запуска: ${err.message}<br><br>Если вы открыли index.html напрямую двойным кликом — запустите локальный сервер (см. README.md), т.к. загрузка JSON/картинок требует http(s), а не file://.</div>`;
  });
});
