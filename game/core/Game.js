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
import { WorldSystem } from '../systems/WorldSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { CombatSystem } from '../systems/CombatSystem.js';
import { SquadCombatSystem } from '../systems/SquadCombatSystem.js';

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
import { LeftBarUI } from '../ui/LeftBarUI.js';
import { CharacterMenuUI } from '../ui/CharacterMenuUI.js';
import { ConstructionUI } from '../ui/ConstructionUI.js';
import { CharacterRosterUI } from '../ui/CharacterRosterUI.js';
import { PartyUI } from '../ui/PartyUI.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { EnemyMenuUI } from '../ui/EnemyMenuUI.js';
import { EnemyInfoUI } from '../ui/EnemyInfoUI.js';
import { DoorMenuUI } from '../ui/DoorMenuUI.js';
import { showStartMenu } from '../ui/StartMenu.js';
import { installOrientationLockRetry } from './OrientationLock.js';

const DEBUG_GRID = false; // flip to true to see the passability grid over the art
const CHARACTER_HEIGHT_TILES = 6.2; // sprite height in grid cells — was 3.6, bumped up per feedback. Рост героев.

// AFK fidget (look left/right, sniff armpit, recoil, return) — a one-shot
// 5-frame gag that plays after a character has stood around doing nothing
// for a while, then holds on the idle pose again until the next trigger.
const AFK_TRIGGER_SECONDS = 8;
const AFK_FRAME_SECONDS = 0.35;
const IDLE_FPS = 2.2; // slow head-turn breathing loop, not meant to read as active motion
const RESOURCE_LABELS = { food: 'еды', water: 'воды', heat: 'тепла', materials: 'материалов' };
const RECRUIT_RANGE_TILES = 1.5; // how close a party member must walk to auto-recruit a waiting NPC
const MAX_PARTY_SIZE = 5; // hard cap on how many settlers can be checked "в отряде" at once
// Only Ольга (char_2) can hack a "hack:<seconds>" door's keypad — see
// _commandHackDoor/_startHacking. She's the party's dedicated hacker (высокий
// интеллект, and the only character with a full multi-frame "examine" sprite
// set — see the char_2 overrides in _loadCharacterSprites).
const HACKER_CHARACTER_ID = 'char_2';
const DEFAULT_HACK_SECONDS = 60; // fallback if a door's "hack:" condition omits a number
const FOLLOW_DISTANCE_TILES = 3; // how far "Выбрать всех" followers stand off from the tank —
                                  // matches monsters' own melee attackDistance (data/enemies/*.json)
                                  // so it reads as a normal combat standoff, not a huddle

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
    // Built from every entry in characters.json, recruited or not, so a
    // save's data (which may include a since-recruited char_2) merges
    // against the right defaults before the recruited/unrecruited split
    // below — see _applySave and _splitRecruits.
    this.characters = charactersData.characters.map((c) => new Character(c));
    // One shared backpack for the whole party (see InventorySystem) —
    // overridden below by _applySave if a save has its own partyInventory.
    this.partyInventory = charactersData.partyInventory ? [...charactersData.partyInventory] : [];
    this.enemies = await this._loadEnemies(mapData);

    if (save) this._applySave(save);
    this._splitRecruits();

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

    // Same idea, for walking over to a corpse to search it — keyed by
    // character id -> enemy id. See _onCorpseTapped / _updatePendingLootInteractions.
    this.pendingLootInteractions = new Map();

    // Same idea again, for walking over to a door/ladder before it actually
    // opens/unlocks/switches level — keyed by character id -> interactable
    // id. See _onInteractableTapped / _updatePendingInteractableInteractions.
    this.pendingInteractableInteractions = new Map();

    // Same idea again, for walking over to a "hack:<seconds>" door's keypad
    // before hacking can start — keyed by character id -> interactable id.
    // See _commandHackDoor / _updatePendingHackInteractions.
    this.pendingHackInteractions = new Map();

    // Active keypad-hacking sessions, keyed by character id -> {interactable,
    // requiredMs}. Only ever holds Ольга today (see HACKER_CHARACTER_ID), but
    // keyed by character so the rule isn't hardcoded into the update loop.
    // See _startHacking / _updateHacking.
    this.hackingSessions = new Map();

    this.movementSystem = new MovementSystem(balance);
    this.characterSystem = new CharacterSystem(balance);
    this.roomSystem = new RoomSystem(this.rooms);
    this.resourceSystem = new ResourceSystem(balance, save?.resources);
    this.temperatureSystem = new TemperatureSystem(balance);
    this.constructionSystem = new ConstructionSystem(this.resourceSystem, this.roomSystem);
    this.worldSystem = new WorldSystem();
    this.gameTime = new GameTime(balance, save?.gameTime);
    this.enemySystem = new EnemySystem(
      this.pathfinder,
      this.movementSystem,
      (enemy, target) => {
        this._toast(`${enemy.name} атакует ${target.name}!`);
      },
      balance
    );
    this.inventorySystem = new InventorySystem(this.itemsById);
    this.combatSystem = new CombatSystem(
      this.itemsById,
      balance,
      (character, enemy) => this._toast(`${character.name} открывает огонь по цели: ${enemy.name}!`),
      (character, enemy) => {
        this._attackEffects.push({
          from: { ...character.position },
          to: { ...enemy.position },
          start: this._now ?? performance.now()
        });
      }
    );
    this.squadCombatSystem = new SquadCombatSystem(this.movementSystem);
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
    if (save.partyInventory) {
      this.partyInventory = [...save.partyInventory];
    }
    if (save.enemies) {
      const savedById = new Map(save.enemies.map((e) => [e.id, e]));
      for (const enemy of this.enemies) {
        const saved = savedById.get(enemy.id);
        if (!saved) continue;
        enemy.health = saved.health;
        enemy.position = { ...saved.position };
        enemy.state = saved.state;
        enemy.lootCollected = saved.lootCollected ?? false;
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
  /**
   * Pulls not-yet-recruited settlers (recruited:false in characters.json,
   * or restored that way from a save) out of this.characters and into
   * this.recruits — they stand around on their home floor (levelId) as a
   * plain waiting NPC, don't move/fight/consume needs, and aren't shown in
   * the roster, until _updateRecruitEncounters notices a party member has
   * walked up to them.
   */
  _splitRecruits() {
    this.recruits = this.characters.filter((c) => !c.recruited);
    this.characters = this.characters.filter((c) => c.recruited);
  }

  _sanitizeCharacterPositions() {
    // Movement is horizontal-only: exactly one row is the "real" floor line
    // (the map's spawn row), so a character saved on any other row — either
    // an unwalkable tile from an older map layout, or a leftover row from
    // before this floor-row rule was restored — needs to snap back to it,
    // or they'd be stuck floating there forever with no way to step back
    // onto the floor.
    const spawn = this.mapData.spawnPoint;
    for (const character of this.characters) {
      const onFloorRow = character.position.row === spawn.row;
      const stillWalkable = this.pathfinder.isWalkable(character.position.col, character.position.row);
      if (!onFloorRow || !stillWalkable) {
        character.position = { ...spawn };
        character.path = [];
        character.moveProgress = 0;
      }
    }
  }

  _buildDom() {
    const app = document.getElementById('app');

    // Resource bar lives above the scene as a slim HUD strip, so the bottom
    // of the screen only has to carry the roster + nav bar, not three stacked bars.
    this.topRoot = document.createElement('div');
    this.topRoot.className = 'top-root';
    app.appendChild(this.topRoot);

    this.sceneWrap = document.createElement('div');
    this.sceneWrap.className = 'scene-wrap';

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sceneWrap.appendChild(this.canvas);
    app.appendChild(this.sceneWrap);

    // A real in-flow strip below the scene — #app is a column flexbox and
    // .scene-wrap only takes flex:1 (the leftover space), so anything
    // appended after it here pushes the canvas up and sits underneath it
    // instead of floating on top. Карта/Инвентарь and the roster used to be
    // position:absolute, pinned to #app's own bottom corners, which put them
    // right over the room the characters walk around in — this bar is what
    // they're mounted into now (see rosterUI/leftBarUI below).
    this.bottomBar = document.createElement('div');
    this.bottomBar.className = 'bottom-bar';
    app.appendChild(this.bottomBar);

    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'ui-root';
    app.appendChild(this.uiRoot);

    // Mounted into bottomBar (not uiRoot/app) so it renders in its own strip
    // below the canvas rather than floating over it — see bottomBar above.
    // Appended first so it lands on the left side of the bar (bottomBar's
    // space-between layout — see style.css), same side it occupied before.
    this.shelterUI = new ShelterUI(this.topRoot);
    this.leftBarUI = new LeftBarUI(this.bottomBar, {
      onMap: () => this._toggleWorldMap(),
      onInventory: () => this._openPartyInventory()
    });

    // Appended second so it lands on the right side of the bar, same corner
    // it occupied before. Also owns the Отряд / Выбрать всех buttons,
    // stacked right above the avatar row — see CharacterRosterUI.js.
    this.rosterUI = new CharacterRosterUI(this.bottomBar, {
      onSelect: (characterId, clickEvent) => {
        const character = this.characters.find((c) => c.id === characterId);
        if (character) this._onCharacterTapped(character, clickEvent.clientX, clickEvent.clientY);
      },
      onOpenParty: () => this._openPartyUI(),
      onToggleFollowAll: () => this._toggleFollowAllParty()
    });
    this.partyUI = new PartyUI(this.uiRoot);
    // "Выбрать всех" state (see CharacterRosterUI's select-all button): when
    // on, a single tap moves the whole in-party squad instead of just the
    // selected settler — see _moveWholeParty.
    this.followAllParty = false;

    // These two float at the exact tap point (see their getBoundingClientRect
    // math), so they're mounted on #app itself rather than uiRoot: uiRoot's
    // own box sits low and short (just the party-controls bar), while #app
    // spans the whole game area — mounting there keeps the
    // click-to-local-coordinate math and the panel's actual containing
    // block in agreement.
    this.characterMenuUI = new CharacterMenuUI(app);
    this.constructionUI = new ConstructionUI(this.uiRoot);
    this.inventoryUI = new InventoryUI(this.uiRoot);
    this.enemyMenuUI = new EnemyMenuUI(app);
    this.enemyInfoUI = new EnemyInfoUI(this.uiRoot);
    this.doorMenuUI = new DoorMenuUI(app);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast hidden';
    this.uiRoot.appendChild(this.toastEl);

    // 'shelter' (default bunker interior) or 'worldmap' (full-screen hex map),
    // toggled by the left bar's Карта/Бункер button — see _toggleWorldMap.
    this.mode = 'shelter';

    window.addEventListener('resize', () => this._resizeCanvas());
    // Safety net for the landscape lock requested by the start menu — if
    // that first attempt was rejected, the next tap anywhere retries it.
    installOrientationLockRetry();
  }

  /** Swaps the whole canvas between the bunker interior and the hex world
   * map. Same button in the left bar drives both directions (see LeftBarUI). */
  _toggleWorldMap() {
    this.mode = this.mode === 'worldmap' ? 'shelter' : 'worldmap';
    this.enemyMenuUI.hide();
    this.characterMenuUI.hide();
    this.doorMenuUI.hide();
    this.inventoryUI.hide();
    this.constructionUI.hide();
    this.characterSystem.deselect();
    // Roster stays visible on both screens now — see _buildDom.
    this.leftBarUI.setMapMode(this.mode === 'worldmap');
  }

  _loadCharacterSprites() {
    // One sprite per animation state, per spec section 25 — placeholders now,
    // swappable for a full sheet later without touching call sites.
    this.sprites = {
      // Slow "looking around" breathing loop — the default pose whenever the
      // character is truly idle and not mid-fidget (see AFK_* below).
      idle: [
        makeImage('game/assets/characters/char_idle_0.png'),
        makeImage('game/assets/characters/char_idle_1.png'),
        makeImage('game/assets/characters/char_idle_2.png'),
        makeImage('game/assets/characters/char_idle_3.png'),
        makeImage('game/assets/characters/char_idle_4.png')
      ],
      // Held still by default — a single frame, looped trivially below the
      // same way the animated char_2 examine set is, so both share one
      // render code path (see EXAMINE_FPS in _renderCharacters).
      examine: [makeImage('game/assets/characters/char_examine.png')],
      run: [
        makeImage('game/assets/characters/char_run_0.png'),
        makeImage('game/assets/characters/char_run_1.png'),
        makeImage('game/assets/characters/char_run_2.png'),
        makeImage('game/assets/characters/char_run_3.png'),
        makeImage('game/assets/characters/char_run_4.png'),
        makeImage('game/assets/characters/char_run_5.png'),
        makeImage('game/assets/characters/char_run_6.png'),
        makeImage('game/assets/characters/char_run_7.png'),
        makeImage('game/assets/characters/char_run_8.png'),
        makeImage('game/assets/characters/char_run_9.png')
      ],
      // Look left → look right → sniff armpit → recoil "фуу" → return, 5
      // frames — a one-shot fidget played by _updateCharacterAfk after a
      // stretch of true idle, not a continuous loop like run/attack.
      afk: [
        makeImage('game/assets/characters/char_afk_0.png'),
        makeImage('game/assets/characters/char_afk_1.png'),
        makeImage('game/assets/characters/char_afk_2.png'),
        makeImage('game/assets/characters/char_afk_3.png'),
        makeImage('game/assets/characters/char_afk_4.png')
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

    // Per-character overrides, keyed by character id — only char_2 (Ольга,
    // the settler found later on level -2) has one so far. Its presence is
    // what marks a sprite set as "directional": real art exists for running
    // both left (runLeft) and right (runRight), and a full 10-frame
    // "изучить" animation (examine, below) — every other pose — idle, afk,
    // attack — is temporarily the same single frame from the left-run set,
    // until the rest of this character's animations are delivered. See
    // _spriteSetFor / _renderCharacters for how the runLeft/runRight split
    // replaces the default set's flip-to-face-left trick (that trick
    // assumes one direction of source art; this character's run/examine art
    // is already directional, so it isn't flipped).
    const char2Placeholder = makeImage('game/assets/characters/char_2/placeholder.png');
    this.characterSpriteSets = new Map([
      ['char_2', {
        // 12 unique poses each (the source exports had every pose
        // duplicated back-to-back to pad out to 24 frames — deduping down
        // to the unique ones here keeps the per-second pose-change rate the
        // same as the default set's run cycle at the same RUN_FPS, instead
        // of updating at half the rate and reading as choppy).
        runLeft: [
          makeImage('game/assets/characters/char_2/run_left_00.png'),
          makeImage('game/assets/characters/char_2/run_left_01.png'),
          makeImage('game/assets/characters/char_2/run_left_02.png'),
          makeImage('game/assets/characters/char_2/run_left_03.png'),
          makeImage('game/assets/characters/char_2/run_left_04.png'),
          makeImage('game/assets/characters/char_2/run_left_05.png'),
          makeImage('game/assets/characters/char_2/run_left_06.png'),
          makeImage('game/assets/characters/char_2/run_left_07.png'),
          makeImage('game/assets/characters/char_2/run_left_08.png'),
          makeImage('game/assets/characters/char_2/run_left_09.png'),
          makeImage('game/assets/characters/char_2/run_left_10.png'),
          makeImage('game/assets/characters/char_2/run_left_11.png')
        ],
        runRight: [
          makeImage('game/assets/characters/char_2/run_right_00.png'),
          makeImage('game/assets/characters/char_2/run_right_01.png'),
          makeImage('game/assets/characters/char_2/run_right_02.png'),
          makeImage('game/assets/characters/char_2/run_right_03.png'),
          makeImage('game/assets/characters/char_2/run_right_04.png'),
          makeImage('game/assets/characters/char_2/run_right_05.png'),
          makeImage('game/assets/characters/char_2/run_right_06.png'),
          makeImage('game/assets/characters/char_2/run_right_07.png'),
          makeImage('game/assets/characters/char_2/run_right_08.png'),
          makeImage('game/assets/characters/char_2/run_right_09.png'),
          makeImage('game/assets/characters/char_2/run_right_10.png'),
          makeImage('game/assets/characters/char_2/run_right_11.png')
        ],
        idle: [char2Placeholder],
        // Raises a hand, summons a holographic analysis panel, holds it
        // open, then closes it and turns away — 10 frames, deduped down
        // from a 24-frame export that repeated every pose 1-4x in a row
        // (see the source zip's frame_NN.png — 000/001 identical,
        // 002-005 identical, etc.). Keeping the unique poses only (rather
        // than dropping to fewer still) and cycling them at EXAMINE_FPS in
        // _renderCharacters is what keeps the loop reading as smooth
        // motion instead of choppy or held-frame stutter.
        examine: [
          makeImage('game/assets/characters/char_2/examine_00.png'),
          makeImage('game/assets/characters/char_2/examine_01.png'),
          makeImage('game/assets/characters/char_2/examine_02.png'),
          makeImage('game/assets/characters/char_2/examine_03.png'),
          makeImage('game/assets/characters/char_2/examine_04.png'),
          makeImage('game/assets/characters/char_2/examine_05.png'),
          makeImage('game/assets/characters/char_2/examine_06.png'),
          makeImage('game/assets/characters/char_2/examine_07.png'),
          makeImage('game/assets/characters/char_2/examine_08.png'),
          makeImage('game/assets/characters/char_2/examine_09.png')
        ],
        afk: [char2Placeholder],
        attack: [char2Placeholder]
      }]
    ]);
  }

  /**
   * Resolves which sprite set a character (or waiting recruit) draws with —
   * their entry in characterSpriteSets if they have one (currently just
   * char_2), otherwise the shared default set every other character/recruit
   * still uses. See _loadCharacterSprites.
   */
  _spriteSetFor(entity) {
    return this.characterSpriteSets.get(entity.id) ?? this.sprites;
  }

  /**
   * The one frame a character's on-screen width is always measured against
   * (see _renderCharacters/_renderRecruits) — their own idle pose, first
   * frame. Loaded before every other animation gets used in practice (idle
   * is the default state), and every character/recruit has one. Falls back
   * to examine or the first available frame only in case a future sprite
   * set is ever missing idle art entirely.
   */
  _referenceSpriteFor(spriteSet) {
    return spriteSet.idle?.[0] ?? spriteSet.examine?.[0] ?? Object.values(spriteSet)[0]?.[0];
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

  // Registers a floor's art in the persistent stack (this.discoveredLevels)
  // instead of replacing a single this.bunkerImage — every floor the party
  // has ever reached keeps its image loaded so it stays visible, stacked in
  // its correct spot below/above the others, once discovered.
  _registerFloor(mapData) {
    let entry = this.discoveredLevels.get(mapData.id);
    if (!entry) {
      const image = new Image();
      image.onerror = () => {
        console.error(`[Game] Не удалось загрузить изображение бункера: ${mapData.image}`);
        this._toast('Не удалось загрузить картинку бункера — карта всё ещё работает.');
      };
      image.src = mapData.image;
      entry = { mapData, image, depth: mapData.depth ?? this.topDepth };
      this.discoveredLevels.set(mapData.id, entry);
    } else {
      entry.mapData = mapData; // keep interactable/grid state fresh on revisit
    }
    return entry;
  }

  // Every floor here currently reuses the same source art (surface +
  // vault door on top, one interior room below — see bunker-map.json's
  // comment), so stacking full images would print that surface/gate
  // backdrop again under every lower floor. Only the topmost floor
  // (the real surface entrance) should show it; every floor below gets
  // cropped to just its own interior band, found from the grid itself —
  // the rows that actually contain non-wall tiles (padded by one row for
  // a bit of wall margin).
  _interiorRowRange(mapData) {
    const grid = mapData.grid;
    let top = -1;
    let bottom = -1;
    for (let r = 0; r < grid.length; r++) {
      if (grid[r].some((cell) => cell !== 0)) {
        if (top === -1) top = r;
        bottom = r;
      }
    }
    if (top === -1) return { top: 0, rows: grid.length }; // no walkable cells found, fall back to full image
    top = Math.max(0, top - 1);
    bottom = Math.min(grid.length - 1, bottom + 1);
    return { top, rows: bottom - top + 1 };
  }

  _loadBunkerImage() {
    this.topDepth = this.mapData.depth ?? -1;
    this.discoveredLevels = new Map();
    this._registerFloor(this.mapData);
    this._resizeCanvas();
  }

  // Floors stack into one tall world (like a bunker cross-section): the
  // canvas is exactly as wide as the visible box (fit-to-width, no
  // horizontal letterbox) and as tall as every discovered floor's slot
  // stacked end to end, and the box scrolls natively to whichever floor is
  // active — so a newly-opened floor simply appears attached below (or
  // above) the ones already there instead of replacing them.
  _resizeCanvas() {
    const boxWidth = this.sceneWrap.clientWidth;
    const boxHeight = this.sceneWrap.clientHeight;
    const { width: imgW } = this.mapData.imageSize;

    this.scale = boxWidth / imgW;
    this.offsetX = 0;

    // Build each discovered floor's slot: the top/surface floor keeps its
    // full art, everything else is cropped to its own interior band. Sorted
    // shallowest-first so cumulative Y stacks top to bottom correctly.
    this.floorLayout = new Map();
    const floors = [...this.discoveredLevels.values()].sort((a, b) => b.depth - a.depth);
    let cumulativeY = 0;
    for (const floor of floors) {
      const cellSize = floor.mapData.cellSize;
      const isTop = floor.depth === this.topDepth;
      const cropTopRow = isTop ? 0 : this._interiorRowRange(floor.mapData).top;
      const cropRows = isTop ? floor.mapData.rows : this._interiorRowRange(floor.mapData).rows;
      const cropTopPx = cropTopRow * cellSize;
      const cropHeightPx = cropRows * cellSize;
      const slotHeight = cropHeightPx * this.scale;

      this.floorLayout.set(floor.depth, { cumulativeY, slotHeight, cropTopPx, cropHeightPx, cropTopRow });
      cumulativeY += slotHeight;
    }

    this.canvas.width = boxWidth;
    this.canvas.height = Math.max(boxHeight, cumulativeY);

    this._focusActiveFloor();
  }

  // Jumps the view straight to the active floor — no tween, just an
  // instant scroll — so gameplay is immediately on that floor while the
  // floors above/below stay in the world, scrollable, above and below it.
  _focusActiveFloor() {
    const layout = this.floorLayout.get(this.mapData.depth);
    if (!layout) return;
    const cellSize = this.mapData.cellSize;
    // Entities are positioned by absolute grid row (e.g. spawnPoint row 28),
    // unaffected by cropping, so the translate has to line row=cropTopRow
    // up with the top of this floor's slot rather than row 0.
    this.offsetY = layout.cumulativeY - layout.cropTopRow * cellSize * this.scale;
    this.sceneWrap.scrollTop = layout.cumulativeY;
  }

  _bindInput() {
    this.canvas.addEventListener('pointerdown', (e) => this._onTap(e));
  }

  _onTap(e) {
    if (this.mode === 'worldmap') {
      this._onWorldMapTap(e);
      return;
    }

    // Any tap on the map dismisses the enemy mini-menu and the character
    // mini-menu, whether or not it hits a new character/enemy right after —
    // they aren't full-screen overlays like the other modals, so they don't
    // swallow the tap itself.
    this.enemyMenuUI.hide();
    this.characterMenuUI.hide();
    this.doorMenuUI.hide();

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
      this._onCharacterTapped(tappedCharacter, e.clientX, e.clientY);
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

    // 2b) Tapped a dead enemy that still has loot on its body? Same hit
    // area as a live enemy (see _enemyHitBounds) — the corpse now renders
    // at full size (see _renderCorpse), just dimmed. Walk over and search it.
    const tappedCorpse = this.enemies.find((en) => {
      if (en.isActive || en.lootCollected || en.loot.length === 0) return false;
      const box = this._enemyHitBounds(en);
      return px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
    });
    if (tappedCorpse) {
      this._onCorpseTapped(tappedCorpse);
      return;
    }

    // 3) Tapped an interactable (door/ladder/furniture)? Furniture keeps its
    // exact single tile (it's drawn as a small precise dot — see
    // _renderInteractables). Doors/ladders use a much bigger, forgiving hit
    // area instead of their own 32px tile — see _interactableHitBounds —
    // matching the shimmer drawn around them, so a tap anywhere in that
    // glowing chunk of the room still lands on the door.
    let interactable = this.interactableStates.get(`${col},${row}`);
    if (!interactable) {
      interactable = this.mapData.interactables.find((it) => {
        if (it.type === 'furniture') return false;
        const box = this._interactableHitBounds(it);
        return px >= box.left && px <= box.right && py >= box.top && py <= box.bottom;
      });
    }
    if (interactable) {
      if (interactable.type === 'furniture') {
        this._onFurnitureTapped(interactable);
      } else {
        this._onInteractableTapped(interactable, e);
      }
      return;
    }

    // 4) Otherwise, move the selected character there — or, with "Выбрать
    // всех" toggled on, move the whole squad at once (see
    // CharacterRosterUI's select-all button and _moveWholeParty). Movement
    // is horizontal-only, so the character always stays on their own row —
    // tapping anywhere in the (visually tall) room just walks them to that
    // column, on the row they're already standing on.
    if (this.followAllParty) {
      this._moveWholeParty(col);
      return;
    }

    const selected = this.characterSystem.getSelected(this.characters);
    if (selected) {
      if (selected.combatState === 'attacking') {
        this._toast(`${selected.name} ведёт бой и не может двигаться.`);
        return;
      }
      this.pendingFurnitureInteractions.delete(selected.id);
      const target = { col, row: selected.position.row };
      const moved = this.movementSystem.moveTo(selected, target, this.pathfinder);
      if (!moved) this._toast('Туда пройти нельзя.');
    }
  }

  _onCharacterTapped(character, screenX, screenY) {
    const alreadySelected = this.characterSystem.selectedId === character.id;
    if (!alreadySelected) {
      // First tap: just select them, ready to receive a move order on the
      // next tap of the floor. No panel — that used to pop open immediately
      // and felt like a huge interface for a single tap.
      this.characterSystem.select(character.id);
      return;
    }
    // Second tap on the same, already-selected character: small menu.
    this.characterMenuUI.show(character, screenX, screenY, {
      onShield: () => this._setTank(character),
      onQueue: (order) => this._setQueueOrder(character, order)
    });
  }

  /** "Щит" — makes this settler the tank (see Character.isTank /
   * SquadCombatSystem). Only one tank at a time, same rule as the "Отряд"
   * screen's bottom-row tap (PartyUI._openPartyUI's onSelectLead). */
  _setTank(character) {
    for (const c of this.characters) {
      c.isTank = c.id === character.id;
    }
    this._toast(`${character.name}: назначен танком.`);
  }

  /** "Очередь" — this settler's place in the firing line behind the tank
   * (see Character.queueOrder / SquadCombatSystem._orderedSquad). */
  _setQueueOrder(character, order) {
    character.queueOrder = order;
    this._toast(`${character.name}: очередь ${order}.`);
  }

  /**
   * Opens the party's shared backpack (see Game.partyInventory /
   * InventorySystem). Unlike the old per-character inventory, equipping an
   * item here can target any recruited settler, not just the one that
   * opened the screen — focusCharacterId only decides which settler's card
   * is highlighted/scrolled into view when the modal opens.
   * @param {string} [focusCharacterId]
   */
  _openPartyInventory(focusCharacterId) {
    this.inventoryUI.show(
      this.characters,
      this.partyInventory,
      this.inventorySystem,
      (characterId, itemId) => {
        const character = this.characters.find((c) => c.id === characterId);
        if (character) this.inventorySystem.equip(character, itemId, this.partyInventory);
        this._openPartyInventory(focusCharacterId); // refresh the modal in place
      },
      (characterId, slot) => {
        const character = this.characters.find((c) => c.id === characterId);
        if (character) this.inventorySystem.unequip(character, slot, this.partyInventory);
        this._openPartyInventory(focusCharacterId);
      },
      () => {},
      focusCharacterId
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

  /**
   * A dead enemy's body stays on the map permanently (frozen idle frame,
   * desaturated/dimmed so it reads as dead) instead of vanishing — see
   * _onCorpseTapped for picking it up. While it still has unclaimed loot it
   * also gets a pulsing amber glow plus a small key marker above it, so it's
   * obvious there's something to search for at a glance.
   */
  _renderCorpse(enemy) {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    const x = (enemy.position.col + 0.5) * cs;
    const groundY = (enemy.position.row + 1) * cs;
    const drawH = cs * CHARACTER_HEIGHT_TILES;

    const spriteSet = this.enemySprites.get(`${enemy.raceId}:${enemy.unitId}`);
    const sprite = spriteSet?.idle?.[0];
    const hasSprite = sprite && sprite.complete && sprite.naturalWidth > 0;
    const drawW = hasSprite ? drawH * (sprite.naturalWidth / sprite.naturalHeight) : drawH * 0.32;

    const hasLoot = !enemy.lootCollected && enemy.loot.length > 0;

    ctx.save();

    if (hasLoot) {
      const now = this._now ?? performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(now / 350);
      const cy = groundY - drawH * 0.35;
      const glow = ctx.createRadialGradient(x, cy, 0, x, cy, drawW * 1.1);
      glow.addColorStop(0, `rgba(232,176,75,${0.3 + 0.25 * pulse})`);
      glow.addColorStop(1, 'rgba(232,176,75,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(x, cy, drawW * 1.1, drawH * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.translate(x, groundY - drawH);
    if (enemy.facingDir < 0) ctx.scale(-1, 1);

    ctx.globalAlpha = 0.75;
    ctx.filter = 'grayscale(1) brightness(0.6)';
    if (hasSprite) {
      ctx.drawImage(sprite, -drawW / 2, 0, drawW, drawH);
    } else {
      ctx.fillStyle = '#3a2424';
      ctx.beginPath();
      ctx.ellipse(0, drawH * 0.18, drawW * 0.22, drawH * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-drawW * 0.18, drawH * 0.32, drawW * 0.36, drawH * 0.6);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;

    ctx.restore();

    if (hasLoot) {
      ctx.save();
      ctx.font = `${Math.max(14, 16 * this.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🔑', x, groundY - drawH - 6);
      ctx.restore();
    }
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
   * Tapping a corpse walks the acting character over to its column first
   * (same "line up on the object's column" rule as furniture — see
   * _onFurnitureTapped), then _updatePendingLootInteractions hands off to
   * _lootCorpse once they arrive.
   */
  _onCorpseTapped(enemy) {
    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (!character) return;

    if (character.combatState === 'attacking') {
      this._toast(`${character.name} ведёт бой и не может отойти к телу.`);
      return;
    }

    if (character.position.col === enemy.position.col) {
      this._lootCorpse(enemy, character);
      return;
    }

    const target = { col: enemy.position.col, row: character.position.row };
    const moved = this.movementSystem.moveTo(character, target, this.pathfinder);
    if (moved) {
      this.pendingLootInteractions.set(character.id, enemy.id);
    } else {
      this._toast('Туда пройти нельзя.');
    }
  }

  _updatePendingLootInteractions() {
    for (const [characterId, enemyId] of this.pendingLootInteractions) {
      const character = this.characters.find((c) => c.id === characterId);
      const enemy = this.enemies.find((en) => en.id === enemyId);

      if (!character || !enemy || !character.isActive || enemy.lootCollected) {
        this.pendingLootInteractions.delete(characterId);
        continue;
      }
      if (character.path.length > 0) continue; // still walking there

      this.pendingLootInteractions.delete(characterId);
      if (character.position.col === enemy.position.col) {
        this._lootCorpse(enemy, character);
      }
    }
  }

  /** Grants an enemy's loot to the party's shared backpack, once — the
   * character standing over the corpse is just who does the searching, not
   * who "owns" the loot (see Game.partyInventory). */
  _lootCorpse(enemy, character) {
    if (enemy.lootCollected || enemy.loot.length === 0) return;
    enemy.lootCollected = true;
    this.partyInventory.push(...enemy.loot);

    const names = enemy.loot.map((id) => this.itemsById.get(id)?.name ?? id).join(', ');
    this._toast(`${character.name} обыскал тело: ${names}`);

    character.animState = 'examine';
    character.facingDir = enemy.position.col >= character.position.col ? 1 : -1;
    clearTimeout(this._examineTimer);
    this._examineTimer = setTimeout(() => {
      character.animState = 'idle';
    }, 1200);
  }

  /**
   * "Атаковать" — walks the selected character to just inside their
   * equipped weapon's range (never onto the enemy's own tile), then stops.
   * Once there the path is empty, so the hero simply stands and faces the
   * target while CombatSystem's per-frame auto-fire does the rest — the
   * hero never chases past that point. No weapon equipped -> falls back to
   * CombatSystem.UNARMED_ATTACK (bare-handed melee, see CombatSystem.js)
   * instead of refusing the order — a settler can always throw a punch.
   */
  _commandAttack(enemy) {
    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (!character || !character.isActive) return;

    const weapon = CombatSystem.effectiveWeapon(character, this.itemsById);

    if (character.combatState === 'attacking' && character.targetEnemyId !== enemy.id) {
      this._toast(`${character.name} уже ведёт бой и не может двигаться.`);
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

  /**
   * Tapping a door/ladder no longer acts on it instantly — the character
   * has to walk over to it first (same "line up on the object's column,
   * staying on your own row" rule as furniture/corpses — see
   * _onFurnitureTapped/_onCorpseTapped). Once they arrive,
   * _updatePendingInteractableInteractions hands off to
   * _performInteractableInteraction, which is where the actual open/unlock/
   * level-switch logic lives.
   */
  _onInteractableTapped(interactable, e) {
    const character = this.characterSystem.getSelected(this.characters) ?? this.characters[0];
    if (!character) return;

    if (character.combatState === 'attacking') {
      this._toast(`${character.name} ведёт бой и не может отойти.`);
      return;
    }

    // Locked "hack:<seconds>" doors go through their keypad's Изучить menu
    // instead of the old walk-then-modal flow below — see _commandHackDoor.
    // Same pattern as _onEnemyTapped's Изучить/Атаковать mini-menu: pop the
    // menu at the tap point first, act only once the player picks a button.
    if (this._isHackDoor(interactable) && interactable.locked) {
      this.doorMenuUI.show(interactable, e.clientX, e.clientY, {
        onExamine: () => this._commandHackDoor(interactable, character)
      });
      return;
    }

    if (character.position.col === interactable.col) {
      this._performInteractableInteraction(interactable, character);
      return;
    }

    this.pendingFurnitureInteractions.delete(character.id);
    // Movement is horizontal-only: doors/ladders are drawn on the wall
    // above the floor line, on a row the character can never actually stand
    // on (and, while locked, isn't walkable at all) — so "walking over" to
    // one means lining up on its column while staying on the character's
    // own floor row, not pathing onto the door's own tile.
    const target = { col: interactable.col, row: character.position.row };
    const moved = this.movementSystem.moveTo(character, target, this.pathfinder);
    if (moved) {
      this.pendingInteractableInteractions.set(character.id, interactable.id);
    } else {
      this._toast('Туда пройти нельзя.');
    }
  }

  _updatePendingInteractableInteractions() {
    for (const [characterId, interactableId] of this.pendingInteractableInteractions) {
      const character = this.characters.find((c) => c.id === characterId);
      const interactable = this.mapData.interactables.find((it) => it.id === interactableId);

      if (!character || !interactable || !character.isActive) {
        this.pendingInteractableInteractions.delete(characterId);
        continue;
      }
      if (character.path.length > 0) continue; // still walking there

      this.pendingInteractableInteractions.delete(characterId);
      if (character.position.col === interactable.col) {
        this._performInteractableInteraction(interactable, character);
      }
    }
  }

  /** Any door whose unlockCondition is "hack:<seconds>" — cracked by walking
   * a character up to its keypad and having them Изучить it continuously,
   * instead of spending resources or an item. See _commandHackDoor. */
  _isHackDoor(interactable) {
    return (
      interactable.type === 'door' &&
      typeof interactable.unlockCondition === 'string' &&
      interactable.unlockCondition.startsWith('hack:')
    );
  }

  /** Parses the required duration out of a "hack:<seconds>" condition,
   * falling back to DEFAULT_HACK_SECONDS if the number's missing/bad. */
  _hackRequiredMs(interactable) {
    const raw = Number(interactable.unlockCondition?.slice('hack:'.length));
    const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HACK_SECONDS;
    return seconds * 1000;
  }

  /**
   * Picked from the door keypad's Изучить button (see DoorMenuUI). Only
   * Ольга can actually crack a keypad — per spec, взлом is her job — so
   * anyone else just gets turned away with a toast and nothing walks/starts.
   * Otherwise this is the same "walk to the door's column first" pattern as
   * every other interactable (_onFurnitureTapped/_onCorpseTapped/
   * _onInteractableTapped): already there -> start immediately, otherwise
   * queue it in pendingHackInteractions for _updatePendingHackInteractions
   * to pick up once she arrives.
   */
  _commandHackDoor(interactable, character) {
    if (character.id !== HACKER_CHARACTER_ID) {
      this._toast('Взламывать двери может только Ольга.');
      return;
    }

    this.pendingFurnitureInteractions.delete(character.id);
    this.pendingInteractableInteractions.delete(character.id);

    if (character.position.col === interactable.col) {
      this._startHacking(interactable, character);
      return;
    }

    const target = { col: interactable.col, row: character.position.row };
    const moved = this.movementSystem.moveTo(character, target, this.pathfinder);
    if (moved) {
      this.pendingHackInteractions.set(character.id, interactable.id);
    } else {
      this._toast('Туда пройти нельзя.');
    }
  }

  _updatePendingHackInteractions() {
    for (const [characterId, interactableId] of this.pendingHackInteractions) {
      const character = this.characters.find((c) => c.id === characterId);
      const interactable = this.mapData.interactables.find((it) => it.id === interactableId);

      if (!character || !interactable || !character.isActive || !interactable.locked) {
        this.pendingHackInteractions.delete(characterId);
        continue;
      }
      if (character.path.length > 0) continue; // still walking there

      this.pendingHackInteractions.delete(characterId);
      if (character.position.col === interactable.col) {
        this._startHacking(interactable, character);
      }
    }
  }

  /**
   * Starts (or resumes — see _updateHacking's interruption handling, which
   * always zeroes progress back out on a break, so "resume" today always
   * means "from zero") a hacking session: Ольга holds her examine pose right
   * at the keypad while _updateHacking below ticks interactable.hackProgressMs
   * up every frame, purely from wall-clock dt — no player input needed once
   * it's running, which is the point ("ей нужно время и чтобы её не
   * беспокоили" — she just needs time, undisturbed).
   */
  _startHacking(interactable, character) {
    interactable.hackProgressMs = interactable.hackProgressMs ?? 0;
    this.hackingSessions.set(character.id, {
      interactable,
      requiredMs: this._hackRequiredMs(interactable),
      lastHealth: character.health
    });

    character.animState = 'examine';
    character.facingDir = interactable.col >= character.position.col ? 1 : -1;
    // No auto-revert timeout here (unlike the brief 1.2-1.8s examine poses
    // elsewhere) — this examine pose needs to hold for the full hack
    // duration; _updateHacking below is what ends it, either by success or
    // by interruption.
    clearTimeout(this._examineTimer);

    this._toast(`${character.name} взламывает панель: ${interactable.label}`);
  }

  /**
   * Ticks every active hacking session. A session ends one of two ways:
   *  - success, once hackProgressMs reaches requiredMs — unlocks the door
   *    (and opens its linked room, if any) exactly like ConstructionSystem's
   *    other unlock paths.
   *  - interruption — she stopped standing at the door, started walking,
   *    got pulled into combat, or took a hit while working. "Не отрываясь"
   *    means literally that: any of these zeroes hackProgressMs back to 0,
   *    so a broken attempt has to start over from scratch, not resume.
   * Either way the session is removed from hackingSessions; a fresh Изучить
   * tap is what starts the next one.
   */
  _updateHacking(dt) {
    for (const [characterId, session] of this.hackingSessions) {
      const character = this.characters.find((c) => c.id === characterId);
      const { interactable } = session;

      const interrupted =
        !character ||
        !character.isActive ||
        !interactable.locked ||
        character.position.col !== interactable.col ||
        character.path.length > 0 ||
        character.combatState === 'attacking' ||
        character.isBeingAttacked ||
        character.animState !== 'examine' ||
        character.health < session.lastHealth;

      if (interrupted) {
        this.hackingSessions.delete(characterId);
        interactable.hackProgressMs = 0;
        if (character && character.isActive && interactable.locked) {
          if (character.animState === 'examine') character.animState = 'idle';
          this._toast(`Взлом прерван: ${interactable.label}`);
        }
        continue;
      }

      session.lastHealth = character.health;
      interactable.hackProgressMs += dt * 1000;

      if (interactable.hackProgressMs >= session.requiredMs) {
        this.hackingSessions.delete(characterId);
        interactable.locked = false;
        interactable.state = 'open';
        interactable.hackProgressMs = 0;
        character.animState = 'idle';

        const linkedRoom =
          interactable.leadsTo && interactable.leadsTo !== 'surface' && !interactable.leadsToFile
            ? this.rooms.find((r) => r.id === interactable.leadsTo)
            : null;
        if (linkedRoom) linkedRoom.open();

        this._toast(`${character.name} взломала дверь: ${interactable.label}`);
      }
    }
  }

  _performInteractableInteraction(interactable, character) {
    // Doors with a leadsToFile are a passage to another level's map, not a
    // room unlock. Once open, tapping it again asks "Перейти на другой
    // этаж?" before actually switching (see _confirmLevelTransition) —
    // jumping floors instantly, with no way to back out, was disorienting.
    // Still-locked ones fall through to the normal unlock modal below,
    // whose onUnlock callback asks the same question after a successful
    // unlock.
    if (interactable.leadsToFile && !interactable.locked) {
      this._confirmLevelTransition(interactable);
      return;
    }

    // Already open and not a passage to another level — nothing left to do
    // here (avoids re-showing the unlock modal, cost row and all, for a door
    // that's already been opened).
    if (!interactable.locked) {
      this._toast(`${interactable.label}: уже открыто.`);
      return;
    }

    // Brief "examining" animation while the info/unlock modal is open.
    if (character) {
      character.animState = 'examine';
      clearTimeout(this._examineTimer);
      this._examineTimer = setTimeout(() => {
        character.animState = 'idle';
      }, 1800);
    }

    const linkedRoom =
      interactable.leadsTo && interactable.leadsTo !== 'surface' && !interactable.leadsToFile
        ? this.rooms.find((r) => r.id === interactable.leadsTo)
        : null;

    this.constructionUI.showLockedInfo(
      interactable,
      linkedRoom,
      this.resourceSystem,
      () => {
        const result = this.constructionSystem.tryUnlock(interactable, linkedRoom, this.partyInventory);
        if (result.ok) {
          this._toast(`Открыто: ${interactable.label}`);
          this.constructionUI.hide();
          if (interactable.leadsToFile) this._confirmLevelTransition(interactable);
        } else if (result.reason === 'insufficient_resources') {
          this._toast('Недостаточно материалов.');
        } else if (result.reason === 'not_available_yet') {
          this._toast('Пока недоступно.');
        } else if (result.reason === 'missing_item') {
          const itemName = this.itemsById.get(result.itemId)?.name ?? result.itemId;
          this._toast(`Нужен предмет: ${itemName}.`);
        }
      },
      () => {},
      this.itemsById
    );
  }

  /**
   * "Перейти на другой этаж?" gate in front of every level switch — see
   * _performInteractableInteraction (both the already-open-door tap and the
   * onUnlock callback right after a fresh unlock funnel through here now).
   * Confirming is what actually calls _switchLevel; cancelling just closes
   * the prompt and leaves the party exactly where they were.
   */
  _confirmLevelTransition(interactable) {
    this.constructionUI.showTransitionConfirm(
      interactable,
      () => this._switchLevel(interactable.leadsToFile, interactable.leadsTo),
      () => {}
    );
  }

  /**
   * Swaps the active floor for another pre-authored map JSON (fetched once,
   * then cached in this.levelCache) — rebuilds the pathfinder/interactable
   * state and reloads that level's enemies, and drops the whole party at its
   * spawnPoint. Used for door_01 → bunker_level_-2 today, but works for any
   * leadsToFile door in either direction (see door_up_01 on level -2).
   *
   * The new floor's art is registered into the persistent stack (see
   * _registerFloor) rather than replacing the previous floor's — it stays
   * attached below (or above) it in the world — and the view jumps straight
   * to the new floor instantly, no slide/tween, since that's where play
   * continues.
   */
  async _switchLevel(fileUrl, levelId) {
    if (this._switchingLevel) return;
    this._switchingLevel = true;
    try {
      this.levelCache = this.levelCache ?? new Map();
      let mapData = this.levelCache.get(fileUrl);
      if (!mapData) {
        mapData = await fetchJson(fileUrl);
        this.levelCache.set(fileUrl, mapData);
      }

      this.mapData = mapData;
      this._registerFloor(mapData);
      this.enemies = await this._loadEnemies(mapData);
      this._loadEnemySprites();

      this.interactableStates = new Map();
      for (const it of this.mapData.interactables) {
        this.interactableStates.set(`${it.col},${it.row}`, it);
      }
      this.pathfinder = new PathfindingSystem(this.mapData.grid, this.interactableStates);

      const spawn = this.mapData.spawnPoint;
      for (const character of this.characters) {
        character.position = { ...spawn };
        character.path = [];
        character.moveProgress = 0;
        character.combatState = 'idle';
        character.targetEnemyId = null;
      }
      this.characterSystem.deselect();
      this.pendingFurnitureInteractions.clear();
      this.pendingLootInteractions.clear();
      this.pendingInteractableInteractions.clear();
      this.pendingHackInteractions.clear();
      this.hackingSessions.clear();
      this.activeFurnitureInteractions.clear();
      this.enemyMenuUI.hide();
      this.characterMenuUI.hide();
      this.doorMenuUI.hide();

      this._resizeCanvas(); // grows the world to fit the new floor and jumps the view to it
      this._toast(this.mapData.name ?? 'Уровень сменён.');
    } finally {
      this._switchingLevel = false;
    }
  }

  /**
   * Tapping furniture no longer starts gathering on the spot — the character
   * has to walk over to it first (movement is horizontal-only, so "over" means
   * lining up on the object's column, on whatever row the character is
   * already standing on — furniture is drawn into the background art at
   * whatever row looks right for the room, not necessarily the character's
   * own floor row). Once they arrive, _updatePendingFurnitureInteractions
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

    // Line up on the furniture's column, staying on the character's own row
    // — keeping their current row is what actually lets them reach it, since
    // pathing onto the furniture's own (background-art) row isn't guaranteed
    // to be reachable by horizontal movement alone.
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

  /**
   * Advances each active character's AFK fidget timer. "Truly idle" means
   * not walking, not mid-examine, and not auto-fighting — any of those
   * resets the timer and cancels a fidget in progress, same as the sprite
   * priority order in _renderCharacters.
   */
  _updateCharacterAfk(dt) {
    for (const character of this.characters) {
      if (!character.isActive) {
        character.afkIdleSeconds = 0;
        character.afkPlaying = false;
        character.afkElapsed = 0;
        continue;
      }

      const isMoving = character.path && character.path.length > 0;
      const trulyIdle = !isMoving && character.animState !== 'examine' && character.combatState !== 'attacking';

      if (!trulyIdle) {
        character.afkIdleSeconds = 0;
        character.afkPlaying = false;
        character.afkElapsed = 0;
        continue;
      }

      if (character.afkPlaying) {
        character.afkElapsed += dt;
        if (character.afkElapsed >= this.sprites.afk.length * AFK_FRAME_SECONDS) {
          character.afkPlaying = false;
          character.afkElapsed = 0;
          character.afkIdleSeconds = 0; // wait out a full idle stretch before fidgeting again
        }
      } else {
        character.afkIdleSeconds += dt;
        if (character.afkIdleSeconds >= AFK_TRIGGER_SECONDS) {
          character.afkPlaying = true;
          character.afkElapsed = 0;
        }
      }
    }
  }

  /**
   * Checks every not-yet-recruited settler on the *current* floor against
   * every active party member's position — walking up to one recruits them
   * on the spot (see spec ask: "подойдя к нему он возьмёт его в отряд"),
   * no confirmation dialog. Settlers waiting on a different floor than the
   * one currently active are skipped entirely (cheap and correct: nobody's
   * near them since the party isn't on that floor right now).
   */
  _updateRecruitEncounters() {
    if (!this.recruits || this.recruits.length === 0) return;

    for (const recruit of this.recruits) {
      if (recruit.levelId && recruit.levelId !== this.mapData.id) continue;

      const partyIsClose = this.characters.some(
        (c) => c.isActive && this._distance(c.position, recruit.position) <= RECRUIT_RANGE_TILES
      );
      if (partyIsClose) {
        this._recruitCharacter(recruit);
        break; // this.recruits mutates inside — resume the rest next frame
      }
    }
  }

  /**
   * Opens the full-screen squad panel from the "Отряд" button. Shows the
   * settlers currently in the active combat squad (inParty !== false,
   * capped at MAX_PARTY_SIZE — see PartyUI.SLOT_LIMIT, which mirrors the
   * same cap) and lets the player pick which one leads (Character.isTank —
   * the lead's hero/vehicle/gadget are the ones shown in the left column
   * and centre info panel). Benched settlers (inParty === false) have no
   * entry point in this screen right now; the old checkbox bench toggle
   * was dropped as part of the redesign.
   */
  _openPartyUI() {
    const squad = this.characters.filter((c) => c.inParty !== false);
    this.partyUI.show(
      squad,
      this.itemsById,
      (characterId) => {
        for (const character of this.characters) {
          // Only one lead/tank at a time — tapping a squad slot makes that
          // settler the lead and clears everyone else's flag.
          character.isTank = character.id === characterId;
        }
        this._openPartyUI();
      },
      () => {}
    );
  }

  /** "Выбрать всех" toggle next to the roster's "Отряд" button. */
  _toggleFollowAllParty() {
    this.followAllParty = !this.followAllParty;
    this._toast(
      this.followAllParty
        ? 'Весь отряд следует за танком.'
        : 'Отряд снова двигается по одному.'
    );
  }

  /**
   * "Выбрать всех" mode: a single tap moves the entire in-party squad
   * instead of just the selected settler. The tank (see PartyUI's shield
   * toggle) leads and walks straight to the tapped column — they're the one
   * enemies target and who takes the hits (see EnemySystem._pickTarget) —
   * everyone else follows and stops FOLLOW_DISTANCE_TILES off from them
   * (same standoff monsters use for their own melee range, not shoulder to
   * shoulder), staggered further back one at a time so they don't stack.
   */
  _moveWholeParty(col) {
    const squad = this.characters.filter((c) => c.isActive && c.inParty !== false);
    if (squad.length === 0) return;

    const leader =
      squad.find((c) => c.isTank) ?? this.characterSystem.getSelected(this.characters) ?? squad[0];
    const followers = squad.filter((c) => c.id !== leader.id);
    // Movement is horizontal-only — the whole squad stays on the leader's
    // own row, whatever it is, and only ever moves toward the tapped column.
    const targetRow = leader.position.row;

    if (leader.combatState !== 'attacking') {
      this.pendingFurnitureInteractions.delete(leader.id);
      this.movementSystem.moveTo(leader, { col, row: targetRow }, this.pathfinder);
    }

    const behindDir = col >= leader.position.col ? -1 : 1; // trail on the side they came from
    followers.forEach((character, i) => {
      if (character.combatState === 'attacking') return;
      this.pendingFurnitureInteractions.delete(character.id);
      const targetCol = col + behindDir * (FOLLOW_DISTANCE_TILES + i);
      // Followers line up on the leader's row, same as the leader itself.
      this.movementSystem.moveTo(character, { col: targetCol, row: targetRow }, this.pathfinder);
    });
  }

  _recruitCharacter(recruit) {
    this.recruits = this.recruits.filter((r) => r.id !== recruit.id);
    recruit.recruited = true;
    recruit.facingDir = 1;
    this.characters.push(recruit);
    this._toast(`${recruit.name} присоединяется к отряду!`);
  }

  _distance(a, b) {
    return Math.hypot(a.col - b.col, a.row - b.row);
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
    this.squadCombatSystem.update(this.characters, this.enemies, this.pathfinder);
    this.movementSystem.update(this.enemies, dt);
    this.combatSystem.update(this.characters, this.enemies, dt);
    this._updateCharacterAfk(dt);
    this._updateRecruitEncounters();
    this._updatePendingFurnitureInteractions();
    this._updateFurnitureInteractions(dt);
    this._updatePendingLootInteractions();
    this._updatePendingInteractableInteractions();
    this._updatePendingHackInteractions();
    this._updateHacking(dt);

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

    // Kept running even while the player is looking at the bunker screen,
    // so a hex-to-hex trip doesn't pause just because the map isn't on screen.
    this.worldSystem.update(dt);

    this.shelterUI.update(this.resourceSystem, this.gameTime);
    this.rosterUI.update(this.characters, this.characterSystem.selectedId, this.followAllParty);
  }

  _render() {
    if (this.mode === 'worldmap') {
      this._renderWorldMap();
      return;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this._renderFloorStack();

    // Night darkening overlay tied to GameTime, cheap but sells the day/night loop.
    if (!this.gameTime.isDay) {
      ctx.fillStyle = 'rgba(5,5,20,0.35)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Everything below is authored in the active floor's image-space;
    // translate once so every draw call can keep using col/row * cellSize *
    // scale like before — this.offsetY now points at wherever that floor
    // sits in the stacked world instead of always being 0.
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);

    if (DEBUG_GRID) this._renderDebugGrid();

    this._renderSurfaceLabel();
    this._renderInteractables();
    this._renderEnemies();
    this._renderCharacters();
    this._renderRecruits();
    this._renderAttackEffects();

    ctx.restore();
  }

  // Draws every discovered floor's art at its own fixed spot in the stacked
  // world (see _resizeCanvas/_focusActiveFloor) — this is the whole "new
  // floor just appears attached below the last one" effect: no camera
  // move, no tween, each floor occupies its own permanent slot in the tall
  // canvas and the scene-wrap scrolls natively between them. Non-top floors
  // are cropped to their interior band only (see _interiorRowRange) so the
  // shared surface/vault-door art doesn't print again under every floor.
  _renderFloorStack() {
    const ctx = this.ctx;
    const drawW = this.canvas.width;
    for (const { image, mapData, depth } of this.discoveredLevels.values()) {
      const layout = this.floorLayout.get(depth);
      if (!layout || !(image.complete && image.naturalWidth > 0)) continue;
      ctx.drawImage(
        image,
        0, layout.cropTopPx, mapData.imageSize.width, layout.cropHeightPx,
        0, layout.cumulativeY, drawW, layout.slotHeight
      );
    }
  }

  // ---- World map (hex grid) -------------------------------------------
  // Full-screen alternative to the bunker canvas above, toggled by
  // _toggleWorldMap. No art yet — plain stroked hexagons, per the "just
  // prepare the groundwork" ask — but the grid, fog of war, and travel
  // timing (this.worldSystem) are all real and ready for a real look later.

  _renderWorldMap() {
    const ctx = this.ctx;
    const size = 34; // hex "radius", center to corner, in px
    const world = this.worldSystem;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Keep the player's current hex centered on screen as they travel.
    const playerPixel = world.pixelOf(world.playerHex, size);
    const cx = this.canvas.width / 2 - playerPixel.x;
    const cy = this.canvas.height / 2 - playerPixel.y;

    ctx.save();
    ctx.translate(cx, cy);

    for (const hex of world.hexes.values()) {
      this._renderHex(hex, size);
    }

    ctx.restore();

    ctx.save();
    ctx.font = '13px monospace';
    ctx.fillStyle = 'rgba(232,176,75,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText('ПУСТОШЬ', this.canvas.width / 2, 24);
    if (world.isTraveling) {
      ctx.font = '11px monospace';
      ctx.fillStyle = 'rgba(232,176,75,0.65)';
      ctx.fillText('В пути...', this.canvas.width / 2, 42);
    } else if (!this._canTravelWorldMap()) {
      ctx.font = '11px monospace';
      ctx.fillStyle = 'rgba(192,57,43,0.85)';
      ctx.fillText('Нужен транспорт-костюм для перемещения', this.canvas.width / 2, 42);
    }
    ctx.restore();
  }

  _renderHex(hex, size) {
    const ctx = this.ctx;
    const world = this.worldSystem;
    const { x, y } = world.pixelOf(hex, size);
    const isHome = hex.q === world.homeHex.q && hex.r === world.homeHex.r;
    const isPlayer = hex.q === world.playerHex.q && hex.r === world.playerHex.r;
    const isTravelTarget = world.traveling && hex.q === world.traveling.to.q && hex.r === world.traveling.to.r;
    const discovered = world.isDiscovered(hex);

    ctx.save();
    ctx.translate(x, y);

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      const px = size * 0.92 * Math.cos(angle);
      const py = size * 0.92 * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    if (!discovered) {
      ctx.fillStyle = '#111319';
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    } else if (isHome) {
      ctx.fillStyle = 'rgba(232,176,75,0.18)';
      ctx.strokeStyle = 'rgba(232,176,75,0.7)';
    } else {
      ctx.fillStyle = '#1b1e28';
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    }
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    if (isHome && discovered) {
      ctx.font = `${Math.max(9, size * 0.24)}px monospace`;
      ctx.fillStyle = 'rgba(232,176,75,0.8)';
      ctx.textAlign = 'center';
      ctx.fillText('БУНКЕР', 0, size * 0.08);
    }

    if (isTravelTarget) {
      // Same progress-ring convention as door-open cooldowns in _renderInteractables.
      const progress = world.travelProgress ?? 0;
      ctx.strokeStyle = '#e8b04b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }

    if (isPlayer) {
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _onWorldMapTap(e) {
    const size = 34;
    const world = this.worldSystem;
    const rect = this.canvas.getBoundingClientRect();
    const playerPixel = world.pixelOf(world.playerHex, size);
    const cx = this.canvas.width / 2 - playerPixel.x;
    const cy = this.canvas.height / 2 - playerPixel.y;

    const localX = e.clientX - rect.left - cx;
    const localY = e.clientY - rect.top - cy;
    const coords = world.hexAt(localX, localY, size);
    const target = world.getHex(coords.q, coords.r);
    if (!target) return;

    if (!this._canTravelWorldMap()) {
      this._toast('Наденьте транспорт-костюм, чтобы выходить на поверхность.');
      return;
    }
    if (world.isTraveling) {
      this._toast('Уже в пути к следующей соте.');
      return;
    }
    const moved = world.tryMoveTo(target);
    if (!moved) this._toast('Можно перейти только в соседнюю соту.');
  }

  /** The wasteland isn't survivable without proper transport tech: at least
   * one active settler needs a vehicle item flagged allowsTravel (see
   * items.json's transport_suit, slot "vehicle") equipped before any
   * hex-to-hex movement on the world map is allowed. Viewing the map is
   * still always fine. */
  _canTravelWorldMap() {
    return this.characters.some((character) => {
      if (!character.isActive || !character.vehicle) return false;
      const item = this.itemsById.get(character.vehicle);
      return item?.allowsTravel === true;
    });
  }

  _renderSurfaceLabel() {
    // Purely cosmetic: labels the vault door visible at the top of the full
    // artwork so it reads as "there, but locked" rather than dead space.
    // Only the top/surface floor shows this — lower floors are cropped to
    // their interior band and never draw that part of the art at all.
    if (this.mapData.depth !== this.topDepth) return;

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

  /**
   * Tap/shine area for a door or ladder — deliberately much bigger than its
   * own single 32px grid tile (same idea as _enemyHitBounds for enemies):
   * instead of a "small square" on the door itself, the whole chunk of the
   * room nearest the door — from the door's row down to the room's floor,
   * and sideways toward whichever wall it's closest to — glows and is
   * tappable. That's the point: on a phone screen, hitting one exact tile
   * flush against a wall is fiddly; hitting "the left/right end of the
   * room" is not.
   *
   * Uses only the raw grid shape (any non-empty cell counts as room space,
   * same convention as _interiorRowRange) — never the runtime locked flag —
   * so the highlighted area doesn't change shape depending on whether the
   * door happens to be locked right now.
   */
  _interactableHitBounds(it) {
    const cellSize = this.mapData.cellSize;
    const grid = this.mapData.grid;
    const rows = grid.length;
    const cols = grid[0].length;

    const inRoom = (col, row) =>
      row >= 0 && row < rows && col >= 0 && col < cols && grid[row][col] !== 0;

    // Floor row directly under the door, then how far down the room goes.
    let floorRow = it.row + 1;
    while (floorRow < rows && !inRoom(it.col, floorRow)) floorRow++;
    if (floorRow >= rows) floorRow = it.row;
    let bottomRow = floorRow;
    while (bottomRow + 1 < rows && inRoom(it.col, bottomRow + 1)) bottomRow++;

    // How far the room extends left/right of the door at that floor row.
    let leftCol = it.col;
    while (leftCol - 1 >= 0 && inRoom(leftCol - 1, floorRow)) leftCol--;
    let rightCol = it.col;
    while (rightCol + 1 < cols && inRoom(rightCol + 1, floorRow)) rightCol++;

    // Highlight roughly a third of the room's width, anchored against
    // whichever wall the door is closer to ("весь левый/правый участок").
    const roomWidthTiles = rightCol - leftCol + 1;
    const bandTiles = Math.max(4, Math.round(roomWidthTiles * 0.35));

    let boundLeftCol, boundRightCol;
    if (it.col - leftCol <= rightCol - it.col) {
      boundLeftCol = leftCol;
      boundRightCol = Math.min(rightCol, leftCol + bandTiles);
    } else {
      boundLeftCol = Math.max(leftCol, rightCol - bandTiles);
      boundRightCol = rightCol;
    }

    return {
      left: boundLeftCol * cellSize,
      right: (boundRightCol + 1) * cellSize,
      top: it.row * cellSize,
      bottom: (bottomRow + 1) * cellSize
    };
  }

  _renderInteractables() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    const now = this._now ?? performance.now();

    for (const it of this.mapData.interactables) {
      if (it.type === 'furniture') {
        // The furniture is already drawn into the background art, so this is
        // just a small breathing dot: green = ready, amber ring filling up =
        // gathering in progress, dim red = on cooldown. No dashed rectangle —
        // that reads as "locked door", which this isn't.
        const x = it.col * cs;
        const y = it.row * cs;
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

      // Doors get a small keypad panel mounted on the wall beside them (see
      // _renderDoorKeypad) instead of the old room-wide shimmer — that's the
      // actual "display with buttons" the door is unlocked through. The big
      // _interactableHitBounds tap area is untouched (still used by _onTap),
      // just no longer painted as a glow across the room.
      if (it.type === 'door') {
        this._renderDoorKeypad(it, now);
        continue;
      }

      // Ladders/other interactables keep the original room-shine treatment —
      // they shimmer across the same generous chunk of the room that's
      // actually tappable (see _interactableHitBounds): what glows is
      // exactly what you can hit with a finger, not just their own tile.
      const box = this._interactableHitBounds(it);
      this._drawInteractableShine(
        ctx,
        box.left * this.scale,
        box.top * this.scale,
        (box.right - box.left) * this.scale,
        (box.bottom - box.top) * this.scale,
        it,
        now
      );
    }
  }

  /**
   * Which side of the door has more open room to mount the keypad on —
   * away from the nearest wall/corner, same "walk the grid outward" approach
   * as _interactableHitBounds' leftCol/rightCol, just picking the roomier
   * side instead of the nearer wall. Returns 1 (mount to the door's right)
   * or -1 (mount to its left).
   */
  _keypadSide(it) {
    const grid = this.mapData.grid;
    const rows = grid.length;
    const cols = grid[0].length;
    const inRoom = (col, row) =>
      row >= 0 && row < rows && col >= 0 && col < cols && grid[row][col] !== 0;

    let floorRow = it.row + 1;
    while (floorRow < rows && !inRoom(it.col, floorRow)) floorRow++;
    if (floorRow >= rows) floorRow = it.row;

    let leftCol = it.col;
    while (leftCol - 1 >= 0 && inRoom(leftCol - 1, floorRow)) leftCol--;
    let rightCol = it.col;
    while (rightCol + 1 < cols && inRoom(rightCol + 1, floorRow)) rightCol++;

    return it.col - leftCol >= rightCol - it.col ? -1 : 1;
  }

  /**
   * The wall-mounted display + button grid next to a door — what "Изучить"
   * actually targets (see DoorMenuUI/_commandHackDoor for hack doors), and
   * the visual replacement for the old plain glowing patch that used to sit
   * right over the door. Screen text reads:
   *  - 🔒 for a locked door nobody's currently working on,
   *  - a live percentage while a hacking session (see _updateHacking) is
   *    running against this exact door,
   *  - 🔓 once unlocked.
   * Colour follows the same state: amber while locked and idle, blue while
   * actively being hacked, mint once open — matching _drawInteractableShine's
   * existing locked/unlocked palette so it still reads consistently next to
   * ladders elsewhere on the floor.
   */
  _renderDoorKeypad(it, now) {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    const side = this._keypadSide(it);

    // Vertical placement: the door's own grid row is just the lintel/frame
    // tile up near the top of the doorway, nowhere near where a character
    // actually stands — mounting the keypad there put it way above eye
    // level. Instead find the floor row right below the door (same walk-
    // down-until-walkable approach as _interactableHitBounds' floorRow) and
    // hang the panel at waist height on a standing character there, same
    // CHARACTER_HEIGHT_TILES sprite scale used everywhere else (see
    // _renderCharacters) — belt-height, not door-frame-height.
    const grid = this.mapData.grid;
    const rows = grid.length;
    const cols = grid[0].length;
    const inRoom = (col, row) =>
      row >= 0 && row < rows && col >= 0 && col < cols && grid[row][col] !== 0;
    let floorRow = it.row + 1;
    while (floorRow < rows && !inRoom(it.col, floorRow)) floorRow++;
    if (floorRow >= rows) floorRow = it.row;

    const groundY = (floorRow + 1) * cs;
    const charDrawH = cs * CHARACTER_HEIGHT_TILES;

    const cx = (it.col + 0.5 + side * 0.72) * cs;
    const cy = groundY - charDrawH * 0.45; // ~waist height on a standing hero
    const panelW = cs * 0.46;
    const panelH = cs * 1.05;

    const isHacking = [...this.hackingSessions.values()].some((s) => s.interactable === it);
    let rgb = it.locked ? '255,196,84' : '120,235,190';
    if (isHacking) rgb = '110,190,255';

    const phase = now / 550 + (it.col + it.row) * 0.6;
    const pulse = 0.5 + 0.5 * Math.sin(phase);

    ctx.save();

    // Panel body, mounted flush to the wall.
    ctx.fillStyle = 'rgba(18,20,24,0.92)';
    this._roundRectPath(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, cs * 0.05);
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},${(0.5 + 0.3 * pulse).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, cs * 0.02);
    ctx.stroke();

    // Screen.
    const screenX = cx - panelW * 0.4;
    const screenY = cy - panelH / 2 + panelH * 0.08;
    const screenW = panelW * 0.8;
    const screenH = panelH * 0.3;
    ctx.fillStyle = `rgba(${rgb},${isHacking ? 0.32 : 0.16})`;
    ctx.fillRect(screenX, screenY, screenW, screenH);

    let label = it.locked ? '🔒' : '🔓';
    if (isHacking) {
      const requiredMs = this._hackRequiredMs(it);
      const progress = requiredMs > 0 ? Math.min(1, (it.hackProgressMs ?? 0) / requiredMs) : 0;
      label = `${Math.round(progress * 100)}%`;
    }
    ctx.font = `${Math.max(9, screenH * 0.6)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(${rgb},0.95)`;
    ctx.fillText(label, cx, screenY + screenH / 2);

    // 3x3 button grid below the screen.
    const gridTop = screenY + screenH + panelH * 0.07;
    const gridW = screenW;
    const btnGap = gridW * 0.1;
    const btnSize = (gridW - btnGap * 2) / 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const bx = screenX + c * (btnSize + btnGap);
        const by = gridTop + r * (btnSize + btnGap);
        ctx.fillStyle = `rgba(${rgb},${(0.22 + 0.18 * pulse).toFixed(3)})`;
        this._roundRectPath(ctx, bx, by, btnSize, btnSize, btnSize * 0.15);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /** Small canvas-path helper — a hand-rolled rounded rect, since not every
   * runtime this prototype targets can be relied on to have ctx.roundRect. */
  _roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /**
   * Soft animated "this can be interacted with" hint for doors/ladders. No
   * flat tinted box and no outline rectangle — those read as a highlighted
   * square/debug overlay, which is exactly what this replaces. Just a very
   * faint breathing tint plus a soft light glint sweeping across the area
   * (see _interactableHitBounds for how big that area is — a chunk of the
   * room, not the door's own tile), so it reads as "this surface catches
   * the light, it's interactive" rather than "there's a marker drawn here".
   * Locked interactables shimmer warm amber (needs a key/resources);
   * already-unlocked ones shimmer a faint cool mint (still tappable, e.g. to
   * walk through or transition floors). Each one's phase is offset by its
   * own position so multiple doors don't pulse in perfect unison.
   */
  _drawInteractableShine(ctx, x, y, w, h, it, now) {
    const phase = now / 650 + (x + y) * 0.015;
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    const rgb = it.locked ? '255,196,84' : '120,235,190';

    ctx.save();

    // Barely-there breathing tint — just enough to notice, not a solid wash
    // over a big chunk of the room.
    ctx.fillStyle = `rgba(${rgb},${(0.035 + pulse * 0.035).toFixed(3)})`;
    ctx.fillRect(x, y, w, h);

    // A soft, fairly wide light glint sweeping slowly across the area, like
    // light catching a polished surface — this is what actually reads as
    // "shiny" rather than a tinted box, and scales with the area so it stays
    // gentle whether it's sweeping across one tile or most of a room.
    const sweepWidth = Math.max(40, w * 0.25);
    const sweep = ((now / 28) + (x + y) * 0.5) % (w + sweepWidth * 2) - sweepWidth;
    const glintGradient = ctx.createLinearGradient(x + sweep - sweepWidth, y, x + sweep + sweepWidth, y);
    glintGradient.addColorStop(0, 'rgba(255,255,255,0)');
    glintGradient.addColorStop(0.5, `rgba(255,255,255,${(0.14 + pulse * 0.14).toFixed(3)})`);
    glintGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glintGradient;
    ctx.fillRect(x, y, w, h);

    ctx.restore();
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
      if (enemy.state === 'dead') {
        this._renderCorpse(enemy);
        continue;
      }

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
      if (enemy.aiState === 'attacking' && enemy.attackAnimRemaining > 0) {
        // Only mid-swing during the brief pulse set right when a hit lands
        // (see EnemySystem._attack) — otherwise it holds an idle "ready"
        // pose below, so the loop doesn't read as attacking nonstop while
        // waiting out attackCooldownRemaining (see the reload bar drawn
        // further down).
        sprite = this._cycleFrame(spriteSet.attack, 8);
      } else if (enemy.aiState === 'attacking') {
        sprite = this._cycleFrame(spriteSet.idle, 4);
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

      // Reload/recharge bar, just above the health bar — only while
      // actually attacking, so it's obvious at a glance when this enemy
      // will land its next hit (fills empty->full as attackCooldownRemaining
      // counts down). See EnemySystem._attack / attackAnimRemaining above.
      if (enemy.aiState === 'attacking' && enemy.attackCooldownSeconds > 0) {
        const readyRatio = 1 - enemy.attackCooldownRemaining / enemy.attackCooldownSeconds;
        const cdBarY = barY - 6;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - barW / 2, cdBarY, barW, 3);
        ctx.fillStyle = readyRatio >= 1 ? '#ffe066' : '#e0a300';
        ctx.fillRect(x - barW / 2, cdBarY, barW * readyRatio, 3);
      }
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

      const spriteSet = this._spriteSetFor(character);
      // Directional sets (currently just char_2) carry their own left- and
      // right-facing frames instead of one set meant to be mirrored — see
      // _loadCharacterSprites.
      const directional = !!spriteSet.runLeft;

      const isMoving = character.path && character.path.length > 0;
      let sprite;
      if (isMoving) {
        // Moving always wins — a character walking into range cancels any
        // stale "attacking" pose from the previous target, same as examine.
        const RUN_FPS = 14; // 10-frame cycle now, vs. the old 3-frame one — bumped up so full strides per second stay the same
        const runFrames = directional
          ? (character.facingDir < 0 ? spriteSet.runLeft : spriteSet.runRight)
          : spriteSet.run;
        const frameIndex = Math.floor((this._now / 1000) * RUN_FPS) % runFrames.length;
        sprite = runFrames[frameIndex];
      } else if (character.combatState === 'attacking' && character.attackAnimRemaining > 0) {
        // Only mid-swing/shot during the brief pulse set right when an
        // attack actually fires (see CombatSystem.update) — otherwise it
        // holds an idle "ready" pose below, so a slow-firing weapon (a
        // revolver, say) doesn't loop the attack animation nonstop while
        // waiting out attackCooldownRemaining (see the reload bar drawn
        // further down).
        const ATTACK_FPS = 10;
        const frameIndex = Math.floor((this._now / 1000) * ATTACK_FPS) % spriteSet.attack.length;
        sprite = spriteSet.attack[frameIndex];
      } else if (character.combatState === 'attacking') {
        const frameIndex = Math.floor((this._now / 1000) * IDLE_FPS) % spriteSet.idle.length;
        sprite = spriteSet.idle[frameIndex];
      } else if (character.afkPlaying) {
        const frameIndex = Math.min(
          spriteSet.afk.length - 1,
          Math.floor(character.afkElapsed / AFK_FRAME_SECONDS)
        );
        sprite = spriteSet.afk[frameIndex];
      } else if (character.animState === 'examine') {
        // Loops for as long as animState stays 'examine' — anywhere from a
        // ~1.2-1.8s "Изучить" look to an open-ended furniture gather
        // session (see _examineEnemy / _startFurnitureGather) — so cycling
        // continuously here, the same way idle/attack do, keeps it smooth
        // regardless of how long that turns out to be, instead of freezing
        // on one frame or restarting choppily.
        const EXAMINE_FPS = 8;
        const frameIndex = Math.floor((this._now / 1000) * EXAMINE_FPS) % spriteSet.examine.length;
        sprite = spriteSet.examine[frameIndex];
      } else {
        const frameIndex = Math.floor((this._now / 1000) * IDLE_FPS) % spriteSet.idle.length;
        sprite = spriteSet.idle[frameIndex];
      }
      const drawH = cs * CHARACTER_HEIGHT_TILES;
      // Width comes from a fixed per-character reference frame (their own
      // idle pose), never from whichever frame happens to be playing right
      // now. Different animation sets (and even different frames within one
      // set — e.g. Ольга's char_2/run_right_*.png source at 480x656 vs her
      // examine/idle art at 512x655, or the default set's char_examine.png
      // at a totally different aspect than char_idle_*.png) were exported at
      // slightly different canvas sizes, so deriving drawW from the active
      // frame's own aspect ratio made the character visibly grow/shrink
      // every time they switched pose (most noticeably stepping into
      // "Изучить"/examine). Anchoring to one constant reference per
      // character keeps their on-screen footprint identical across every
      // state — idle, run, examine, afk, attack.
      const refSprite = this._referenceSpriteFor(spriteSet);
      const drawW = refSprite.naturalWidth
        ? drawH * (refSprite.naturalWidth / refSprite.naturalHeight)
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
        // The default set is one direction of art, mirrored to face left;
        // directional sets (char_2) already have real per-direction frames
        // (or a same-either-way placeholder), so they're never flipped.
        if (character.facingDir < 0 && !directional) ctx.scale(-1, 1);
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

      // Reload/recharge bar above the name — only while actually
      // attacking, so it's clear at a glance when this settler's weapon
      // (revolver, fists, ...) will fire again. Fills empty->full as
      // attackCooldownRemaining counts down; ловкость speeds this up for
      // melee weapons only (see CombatSystem._effectiveCooldownSeconds).
      if (character.combatState === 'attacking' && character.attackCooldownSeconds > 0) {
        ctx.save();
        const barW = cs * 1.2;
        const readyRatio = 1 - character.attackCooldownRemaining / character.attackCooldownSeconds;
        const cdBarY = groundY - drawH - 16;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - barW / 2, cdBarY, barW, 3);
        ctx.fillStyle = readyRatio >= 1 ? '#8be26b' : '#4caf50';
        ctx.fillRect(x - barW / 2, cdBarY, barW * readyRatio, 3);
        ctx.restore();
      }
    }
  }

  /**
   * Draws a not-yet-recruited settler standing on their home floor, waiting
   * to be walked up to (see _updateRecruitEncounters). Only ever the idle
   * pose — they never move, fight, or animate — plus a small floating
   * prompt so it doesn't read as just another background prop.
   */
  _renderRecruits() {
    if (!this.recruits || this.recruits.length === 0) return;
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;

    for (const recruit of this.recruits) {
      if (recruit.levelId && recruit.levelId !== this.mapData.id) continue;

      const x = (recruit.position.col + 0.5) * cs;
      const groundY = (recruit.position.row + 1) * cs;

      const spriteSet = this._spriteSetFor(recruit);
      const frameIndex = Math.floor((this._now / 1000) * IDLE_FPS) % spriteSet.idle.length;
      const sprite = spriteSet.idle[frameIndex];
      const drawH = cs * CHARACTER_HEIGHT_TILES;
      // Same fixed reference-frame width as _renderCharacters, so a recruit
      // doesn't wobble in size across their own idle cycle either.
      const refSprite = this._referenceSpriteFor(spriteSet);
      const drawW = refSprite.naturalWidth
        ? drawH * (refSprite.naturalWidth / refSprite.naturalHeight)
        : drawH * 0.32;

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, groundY - 2, drawW * 0.5, cs * 0.28, 0, 0, Math.PI * 2);
      const glow = ctx.createRadialGradient(x, groundY, 0, x, groundY, drawW * 0.6);
      glow.addColorStop(0, 'rgba(120,200,255,0.35)'); // cool tint, distinct from the warm party glow
      glow.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = glow;
      ctx.fill();

      if (sprite.complete && sprite.naturalWidth > 0) {
        ctx.translate(x, groundY - drawH);
        ctx.drawImage(sprite, -drawW / 2, 0, drawW, drawH);
      }
      ctx.restore();

      ctx.save();
      ctx.font = `bold ${Math.max(11, 12 * this.scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0b0d0a';
      ctx.fillText(`${recruit.name} (незнакомец)`, x, groundY - drawH - 6 + 1);
      ctx.fillStyle = '#a9d8ff';
      ctx.fillText(`${recruit.name} (незнакомец)`, x, groundY - drawH - 6);
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
      partyInventory: [...this.partyInventory],
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
