// Game.js
// Entry point. Loads JSON data, builds every system, runs the render/update loop,
// and translates taps into pathfinding / UI actions. This file intentionally
// contains the canvas rendering code (image + grid + character dots) since the
// prototype doesn't need a separate renderer module yet — everything else
// (pathfinding, resources, temperature, rooms...) lives in its own system file.

import { PathfindingSystem } from '../systems/PathfindingSystem.js?v=48';
import { MovementSystem } from '../systems/MovementSystem.js?v=48';
import { CharacterSystem } from '../systems/CharacterSystem.js?v=48';
import { ConstructionSystem } from '../systems/ConstructionSystem.js?v=48';
import { WorldSystem } from '../systems/WorldSystem.js?v=48';
import { InventorySystem } from '../systems/InventorySystem.js?v=48';
import { CombatSystem } from '../systems/CombatSystem.js?v=48';
import { SquadCombatSystem } from '../systems/SquadCombatSystem.js?v=48';

import { GameTime } from './GameTime.js?v=48';
import { ResourceSystem } from './ResourceSystem.js?v=48';
import { TemperatureSystem } from './TemperatureSystem.js?v=48';
import { SaveSystem } from './SaveSystem.js?v=48';

import { Character } from '../entities/Character.js?v=48';
import { Enemy } from '../entities/Enemy.js?v=48';
import { Item } from '../entities/Item.js?v=48';
import { EnemySystem } from '../systems/EnemySystem.js?v=48';
import { SkillSystem } from '../systems/SkillSystem.js?v=48';
import { InteractionSystem } from '../systems/InteractionSystem.js?v=48';

import { ShelterUI } from '../ui/ShelterUI.js?v=48';
import { LeftBarUI } from '../ui/LeftBarUI.js?v=48';
import { CharacterMenuUI } from '../ui/CharacterMenuUI.js?v=48';
import { ConstructionUI } from '../ui/ConstructionUI.js?v=48';
import { CharacterRosterUI } from '../ui/CharacterRosterUI.js?v=48';
import { PartyUI } from '../ui/PartyUI.js?v=48';
import { InventoryUI } from '../ui/InventoryUI.js?v=48';
import { EnemyMenuUI } from '../ui/EnemyMenuUI.js?v=48';
import { EnemyInfoUI } from '../ui/EnemyInfoUI.js?v=48';
import { DoorMenuUI } from '../ui/DoorMenuUI.js?v=48';
import { showStartMenu } from '../ui/StartMenu.js?v=48';
import { installOrientationLockRetry } from './OrientationLock.js?v=48';

const DEBUG_GRID = false; // flip to true to see the passability grid over the art
const CHARACTER_HEIGHT_TILES = 6.2; // sprite height in grid cells — was 3.6, bumped up per feedback. Рост героев.

// ---- 2.5D parallax room scenes ----------------------------------------
// A map whose JSON has a "parallax" block (see game/map/scenes/*.json) is a
// "room scene": a single horizontal stage with its own camera that follows
// the lead character, instead of the older single-image-per-floor stack
// (see _renderFloorStack/_registerFloor, still used for any map that has no
// "parallax" block — nothing about that old path changed). Doors switch
// between room scenes exactly the same way they always switched between
// floors: _switchLevel/leadsToFile doesn't know or care which rendering
// mode either side uses.
const ROOM_VISIBLE_COLS = 19; // how many grid columns are visible across the viewport width at once,
                               // in the normal (not-zoomed-out) camera-follow view — default for any
                               // room scene that doesn't set its own visibleCols
const INITIAL_ROOM_FILE = 'game/map/scenes/cryo_room_01.json'; // must match the fetchJson call in init() —
                                                                // see _loadBunkerImage/_registerRoom's fileUrl
const ROOM_CAMERA_LERP_PER_SEC = 6; // higher = camera snaps to the character faster
const FOREGROUND_FADE_FRACTION = 0.16; // fraction of the viewport width each foreground
                                        // edge fades out over — see _renderForegroundFaded

// AFK fidget (look left/right, sniff armpit, recoil, return) — a one-shot
// 8-frame gag that plays after a character has stood around doing nothing
// for a while, then holds on the idle pose again until the next trigger.
const AFK_TRIGGER_SECONDS = 8;
const AFK_FRAME_SECONDS = 0.35;
const IDLE_FPS = 2.2; // slow head-turn breathing loop, not meant to read as active motion
const RESOURCE_LABELS = { provisions: 'провизии', heat: 'тепла', materials: 'материалов' };
// Energy bolt VFX (see _loadEffectSprites/_renderAttackEffects) — travel time
// scales with distance so a shot across the room doesn't cross the screen in
// the same eyeblink as a point-blank one, then the impact clip plays once at
// the target, fixed-length regardless of range.
const ATTACK_EFFECT_TRAVEL_BASE_MS = 60;
const ATTACK_EFFECT_TRAVEL_PER_TILE_MS = 25;
const ATTACK_EFFECT_IMPACT_MS = 500;
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
    const [balance, mapData, charactersData, itemsData, skillsData, interactionsData] = await Promise.all([
      fetchJson('game/data/balance.json'),
      fetchJson(INITIAL_ROOM_FILE),
      fetchJson('game/data/characters.json'),
      fetchJson('game/data/items.json'),
      fetchJson('game/data/skills.json'),
      fetchJson('game/data/interactions.json')
    ]);

    this.balance = balance;
    this.mapData = mapData;
    this.itemsById = new Map(itemsData.items.map((i) => [i.id, new Item(i)]));
    this.skillsById = new Map(skillsData.skills.map((s) => [s.id, s]));
    // Squad interactions (race-agnostic — see InteractionSystem.js for
    // why nothing here or there is hardcoded to any one race). Ships with
    // an empty interactions.json for now; nothing currently calls
    // getActive()/applyEffect(), this is just wired up and ready for
    // whichever future feature (a squad-bonus UI, a combat-stat hook,
    // ...) is the first to actually use it.
    this.interactionSystem = new InteractionSystem(interactionsData);

    const save = new SaveSystem().load();
    this.saveSystem = new SaveSystem();

    // Built from every entry in characters.json, recruited or not, so a
    // save's data (which may include a since-recruited char_2) merges
    // against the right defaults before the recruited/unrecruited split
    // below — see _applySave and _splitRecruits.
    this.characters = charactersData.characters.map((c) => new Character(c));
    // Kept for _loadCharacterSprites, which runs later (after _buildDom) —
    // each entry's "sprites" block (idle/run/afk/attack/examine paths, or
    // runLeft/runRight for directional art) drives that character's sprite
    // set. See game/data/characters.json and the README-style comment on
    // _loadCharacterSprites for the schema.
    this.charactersData = charactersData;
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
    this.resourceSystem = new ResourceSystem(balance, save?.resources);
    this.temperatureSystem = new TemperatureSystem(balance);
    this.constructionSystem = new ConstructionSystem();
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
      (character, enemy) => {
        this._toast(`${character.name} открывает огонь по цели: ${enemy.name}!`);
        // Attacking any one enemy calls its whole faction (raceId) down on
        // the party at once — see EnemySystem.alertFaction/Enemy.alerted.
        this.enemySystem.alertFaction(this.enemies, enemy.raceId);
      },
      (character, enemy) => {
        const dist = Math.hypot(enemy.position.col - character.position.col, enemy.position.row - character.position.row);
        this._attackEffects.push({
          from: { ...character.position },
          to: { ...enemy.position },
          start: this._now ?? performance.now(),
          travelMs: ATTACK_EFFECT_TRAVEL_BASE_MS + dist * ATTACK_EFFECT_TRAVEL_PER_TILE_MS
        });
      }
    );
    this.squadCombatSystem = new SquadCombatSystem(this.movementSystem);
    this.skillSystem = new SkillSystem(this.skillsById, balance, (character, skill) => {
      this._toast(`${character.name} применяет умение: ${skill.name}!`);
    });
    this._attackEffects = []; // in-flight/impacting energy bolt VFX, see _renderAttackEffects

    this._buildDom();
    this._loadBunkerImage();
    this._loadCharacterSprites();
    this._loadEnemySprites();
    this._loadEffectSprites();
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

    // Zoom controls — a sticky, zero-height wrapper placed BEFORE the
    // canvas so its normal flow position is at the very top of the
    // scrollable content; the actual buttons inside are absolutely
    // positioned within it. That combination is what keeps them pinned to
    // the top-right corner of the visible viewport. "Отдалить" shows every
    // discovered room at once (_resizeCanvasOverview); "Приблизить"
    // returns to the normal camera-follow single-room view — see
    // _setOverview. Combat automatically forces the follow view back on
    // and re-centers on the fight (see _update), so overview is purely
    // for looking around the base between fights.
    this.zoomControlsWrap = document.createElement('div');
    this.zoomControlsWrap.className = 'zoom-controls-wrap';
    this.zoomControls = document.createElement('div');
    this.zoomControls.className = 'zoom-controls';
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'zoom-btn';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.setAttribute('aria-label', 'Отдалить');
    zoomOutBtn.addEventListener('click', () => this._setOverview(true));
    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'zoom-btn';
    zoomInBtn.textContent = '+';
    zoomInBtn.setAttribute('aria-label', 'Приблизить');
    zoomInBtn.addEventListener('click', () => this._setOverview(false));
    this.zoomControls.appendChild(zoomOutBtn);
    this.zoomControls.appendChild(zoomInBtn);
    this.zoomControlsWrap.appendChild(this.zoomControls);
    this.sceneWrap.appendChild(this.zoomControlsWrap);

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
    // Appended first so it lands on the left side of the bar, same side it
    // occupied before — now the left end of the pipe-and-panel HUD (see
    // .hud-left/.hud-pipe/.hud-right in style.css).
    this.shelterUI = new ShelterUI(this.topRoot);
    this.leftBarUI = new LeftBarUI(this.bottomBar, {
      onMap: () => this._toggleWorldMap(),
      onInventory: () => this._openPartyInventory()
    });

    // The straight pipe segment connecting .hud-left to .hud-right (see
    // CharacterRosterUI below) — pure decoration, no UI class of its own,
    // stretches/tiles to fill whatever width is left between the two ends
    // (see .hud-pipe in style.css).
    this.hudPipe = document.createElement('div');
    this.hudPipe.className = 'hud-pipe';
    this.bottomBar.appendChild(this.hudPipe);

    // Appended third so it lands on the right side of the bar, same corner
    // it occupied before. Also owns the Отряд / Выбрать всех buttons,
    // stacked right above the portrait panel — see CharacterRosterUI.js.
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

  /**
   * Turns one character's "sprites" block from characters.json (arrays of
   * image paths, keyed by pose: idle/run/afk/attack/examine/death, or
   * runLeft/runRight instead of run for directional art — see
   * _spriteSetFor/_renderCharacters, which auto-detects "directional" by
   * the presence of runLeft) into the equivalent object of loaded Image
   * arrays that the renderer expects. death (see _renderCharacters) is
   * optional — a character without one just keeps their last pose,
   * tinted grey, when they die, same as before this existed.
   */
  _buildSpriteSet(spritesDef) {
    const set = {};
    for (const pose of ['idle', 'run', 'runLeft', 'runRight', 'afk', 'attack', 'examine', 'death']) {
      if (spritesDef[pose]) set[pose] = spritesDef[pose].map((path) => makeImage(path));
    }
    return set;
  }

  /**
   * Builds one sprite set per character straight from each entry's
   * "sprites" block in characters.json — see game/data/characters.json and
   * _buildSpriteSet. To add a new hero: copy an existing character block in
   * that file, give it a new id/name/stats, and either point "sprites" at
   * its own art folder or reuse an existing character's paths (e.g.
   * char_1's shared default set) until dedicated art exists — no code
   * changes needed here. this.sprites (the char_1 set) stays as a fallback
   * for any entity whose id isn't found, matching prior behaviour.
   */
  _loadCharacterSprites() {
    this.characterSpriteSets = new Map(
      this.charactersData.characters.map((c) => [c.id, this._buildSpriteSet(c.sprites)])
    );
    this.sprites = this.characterSpriteSets.get('char_1');
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

  /**
   * The energy bolt CombatSystem's onAttack fires — see _attackEffects/
   * _renderAttackEffects. Two clips cut from one VFX sheet: a 12-frame
   * "projectile" (the bolt growing from a spark to a full comet as it
   * flies) and a 12-frame "impact" (the burst on arrival, growing then
   * fading). Every INNATE_ATTACK shot uses this same pair regardless of
   * shooter — there's only ever been the one energy gauntlet in the game so
   * far (see CombatSystem.js); once real weapon items exist, this can grow
   * into a per-weapon lookup the same way character sprite sets are.
   */
  _loadEffectSprites() {
    const num = (n) => String(n).padStart(2, '0');
    this.effectSprites = {
      projectile: Array.from({ length: 12 }, (_, i) =>
        makeImage(`game/assets/effects/energy_bolt/projectile_${num(i)}.png`)
      ),
      impact: Array.from({ length: 12 }, (_, i) =>
        makeImage(`game/assets/effects/energy_bolt/impact_${num(i)}.png`)
      )
    };
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
    this._roomMode = !!this.mapData.parallax;
    if (this._roomMode) {
      this.discoveredRooms = new Map();
      const entry = this._registerRoom(this.mapData, INITIAL_ROOM_FILE);
      this.roomLayers = entry.layers;
    } else {
      this.topDepth = this.mapData.depth ?? -1;
      this.discoveredLevels = new Map();
      this._registerFloor(this.mapData);
    }
    this._resizeCanvas();
  }

  /**
   * Adds a room scene's parallax art to the persistent stack
   * (this.discoveredRooms) — called once per room the first time it's ever
   * loaded (here at init, and from _switchLevel whenever a door leads
   * somewhere new), so previously-visited rooms stay part of the visible
   * world, stacked above/below each other, instead of being replaced the
   * moment the party walks on — mirrors _registerFloor's job for the
   * older non-parallax floor art. Returns the (new or existing) entry.
   * fileUrl is stored on the entry too — see _travelToRoom, which needs it
   * to re-run _switchLevel for a room the player tapped directly in
   * overview mode rather than through one of its own doors.
   */
  _registerRoom(mapData, fileUrl) {
    let entry = this.discoveredRooms.get(mapData.id);
    if (!entry) {
      entry = { mapData, layers: this._buildRoomLayers(mapData), depth: this.discoveredRooms.size, fileUrl };
      this.discoveredRooms.set(mapData.id, entry);
    }
    return entry;
  }

  /**
   * Loads a room scene's parallax layer images (see the "parallax" block in
   * game/map/scenes/*.json) into a fresh layers object — pure, doesn't
   * touch this.roomLayers itself (see _registerRoom/_switchLevel, which
   * decide where the result goes). Any layer the room's JSON doesn't
   * define (e.g. the stub corridors only have a background) is simply
   * skipped by the renderer — a room scene needs at minimum a background.
   */
  _buildRoomLayers(mapData) {
    const p = mapData.parallax;
    const load = (src) => {
      if (!src) return null;
      const img = new Image();
      img.onerror = () => console.error(`[Game] Не удалось загрузить слой окружения: ${src}`);
      img.src = src;
      return img;
    };
    return {
      background: load(p.background),
      midground: load(p.midground),
      foreground: load(p.foreground),
      floor: load(p.floor)
    };
  }

  // Floors stack into one tall world (like a bunker cross-section): the
  // canvas is exactly as wide as the visible box (fit-to-width, no
  // horizontal letterbox) and as tall as every discovered floor's slot
  // stacked end to end, and the box scrolls natively to whichever floor is
  // active — so a newly-opened floor simply appears attached below (or
  // above) the ones already there instead of replacing them.
  _resizeCanvas() {
    if (this._roomMode) {
      if (this._overview) this._resizeCanvasOverview();
      else this._resizeCanvasRoomFollow();
      return;
    }
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

  // Room-scene equivalent of _resizeCanvas/_focusActiveFloor above: every
  // discovered room stacks into one tall world exactly like the old floor
  // art did, just built from parallax layers instead of flat floor images
  // Normal (not overview) room view: back to how a single room worked
  // originally, before the Fallout-Shelter-style stack — the canvas is
  // exactly the visible viewport and a camera (this.offsetX/_camX, updated
  // every frame by _updateCamera) follows the selected/leading party
  // member horizontally across the room, showing only ROOM_VISIBLE_COLS
  // worth of it at once rather than the whole width. Only the active
  // room's own art/entities are ever drawn in this mode — see _render's
  // this._overview check. See _resizeCanvasOverview for the other mode
  // (button-toggled — see _setOverview), which is what actually shows the
  // rest of the discovered base at once.
  /**
   * How many grid-rows tall a room's art actually needs to be shown
   * without cropping OR distorting it — normally just mapData.rows, but
   * some rooms' background/midground layers have real proportions taller
   * than the grid's own row count once drawn at their own aspect ratio
   * (see _renderParallaxLayers) rather than force-stretched to fit it.
   * Used to shrink the whole scene (via heightScale in
   * _resizeCanvasRoomFollow/_resizeCanvasOverview) just enough to fit the
   * tallest layer in, instead of clipping it or squashing it back to the
   * grid's own aspect. Character/tile positioning still uses the real
   * mapData.rows elsewhere — this is purely a "how much vertical space
   * does the visible art need" question.
   */
  _roomEffectiveRows(mapData, layers) {
    let maxRows = mapData.rows;
    if (layers) {
      for (const name of ['background', 'midground']) {
        const img = layers[name];
        if (img?.naturalWidth) {
          const rows = mapData.cols * (img.naturalHeight / img.naturalWidth);
          if (rows > maxRows) maxRows = rows;
        }
      }
    }
    return maxRows;
  }

  _resizeCanvasRoomFollow() {
    const boxWidth = this.sceneWrap.clientWidth;
    const boxHeight = this.sceneWrap.clientHeight;
    const cellSize = this.mapData.cellSize;

    const visibleCols = this.mapData.visibleCols ?? ROOM_VISIBLE_COLS;
    // MUST be the SMALLER of the two, not the larger — a previous version
    // of this took the larger one specifically to guarantee the room's own
    // 8 rows covered at least the full viewport height, but that's exactly
    // backwards: a *bigger* scale makes the room *taller* in pixels, and
    // since offsetY below anchors the floor row a fixed distance above the
    // canvas's own bottom edge (not the room's total height), a taller
    // room pushes row 0 — and a standing character's head, which reaches
    // above row 0 — further up and off the top of the canvas, not less.
    // Taking the smaller scale instead means the room (all `effectiveRows`
    // rows, top to bottom — see _roomEffectiveRows, which can be more than
    // the grid's own row count for art with unusually tall proportions,
    // like reactor_room_01's midground) is always guaranteed to fit within
    // the viewport on both axes — the trade-off is a bit of empty space on
    // whichever axis isn't the limiting one, instead of ever clipping or
    // squashing the room art (or the character) to make it fit.
    const effectiveRows = this._roomEffectiveRows(this.mapData, this.roomLayers);
    const widthScale = boxWidth / (visibleCols * cellSize);
    const heightScale = boxHeight / (effectiveRows * cellSize);
    this.scale = Math.min(widthScale, heightScale);
    this.roomWidthPx = this.mapData.cols * cellSize * this.scale;
    // Real grid rows here, not effectiveRows — this is what floor/
    // character positioning below (and in _renderCharacters etc.) is
    // measured against, unchanged regardless of how tall the art is.
    this.roomHeightPx = this.mapData.rows * cellSize * this.scale;

    this.canvas.width = boxWidth;
    this.canvas.height = boxHeight;
    // No native DOM scrolling in this mode — the camera pans instead (see
    // _updateCamera).
    this.sceneWrap.scrollTop = 0;

    // Keep the floor row a fixed distance above the bottom of the screen.
    const floorRow = this.mapData.spawnPoint.row;
    const bottomMargin = boxHeight * 0.12;
    this.offsetY = boxHeight - (floorRow + 1) * cellSize * this.scale - bottomMargin;
    // Belt-and-braces: never let the room's own top edge drop below the
    // canvas's top edge (a gap above the art) — with the min-scale above
    // this shouldn't trigger in practice, but costs nothing to guard.
    this.offsetY = Math.min(0, this.offsetY);

    this._updateCamera(0); // snap instantly on load/resize/mode-switch, no lerp
  }

  /**
   * Moves the camera toward the selected (or first) party member's column
   * every frame (see _update), clamped so it never shows past the room's
   * own left/right edges. dt===0 (room just loaded/resized/switched back
   * from overview) snaps instantly instead of easing in from wherever the
   * camera happened to be. No-ops in overview mode — see _setOverview.
   */
  _updateCamera(dt) {
    if (!this._roomMode || this._overview) return;
    const cellSize = this.mapData.cellSize;
    // See _activeSelectedCharacter — a dead selected/first character never
    // anchors the camera, so it can't strand the rest of the party
    // off-screen the way it used to.
    const leader = this._activeSelectedCharacter();
    const focusCol = leader ? leader.position.col : this.mapData.spawnPoint.col;
    const targetWorldX = (focusCol + 0.5) * cellSize * this.scale;
    const maxCamX = Math.max(0, this.roomWidthPx - this.canvas.width);
    const targetCamX = Math.min(maxCamX, Math.max(0, targetWorldX - this.canvas.width / 2));

    if (this._camX === undefined || dt === 0) {
      this._camX = targetCamX;
    } else {
      const t = Math.min(1, dt * ROOM_CAMERA_LERP_PER_SEC);
      this._camX += (targetCamX - this._camX) * t;
    }
    this.offsetX = -this._camX;
  }

  /**
   * Overview mode (toggled by the −/+ controls — see _setOverview): every
   * discovered room stacked and shrunk to fit the *whole* base into the
   * viewport at once, no scrolling needed — this is what actually answers
   * "let me see all the floors I've opened". Unlike the normal
   * camera-follow view, nothing here tracks the party; it's a static
   * look-around. Combat forces this back off — see _update.
   */
  _resizeCanvasOverview() {
    const boxWidth = this.sceneWrap.clientWidth;
    const boxHeight = this.sceneWrap.clientHeight;
    const rooms = [...this.discoveredRooms.values()].sort((a, b) => a.depth - b.depth);

    // Character sprites are drawn considerably taller than one room's own
    // row height (see CHARACTER_HEIGHT_TILES vs a typical 8-row room) —
    // heads routinely reach above the room art's own "ceiling" line, which
    // the normal follow view always had headroom for (its own bottomMargin
    // math). Packing rooms edge-to-edge here with zero gap left nothing
    // above the very first room in the stack, clipping anyone standing in
    // it against the canvas's own top edge. HEADROOM_FRACTION reserves a
    // slice of one room's height above the whole stack to fix that.
    const HEADROOM_FRACTION = 0.35;

    // Each room's slot uses its own effectiveRows (see _roomEffectiveRows)
    // instead of always its grid's own row count — a room whose art is
    // naturally taller than its grid (reactor_room_01's midground, for
    // one) gets a taller slot to match, so _renderRoomStackBackdrop's clip
    // never has to crop it.
    let naturalTotalHeight = 0;
    let naturalRoomHeight = 0;
    for (const room of rooms) {
      const cellSize = room.mapData.cellSize;
      const scale = boxWidth / (room.mapData.cols * cellSize);
      const effectiveRows = this._roomEffectiveRows(room.mapData, room.layers);
      const h = effectiveRows * cellSize * scale;
      naturalRoomHeight = h; // used as a headroom reference either way — doesn't need to be exact
      naturalTotalHeight += h;
    }
    const naturalHeadroom = naturalRoomHeight * HEADROOM_FRACTION;
    const fitFactor =
      naturalTotalHeight + naturalHeadroom > boxHeight ? boxHeight / (naturalTotalHeight + naturalHeadroom) : 1;

    this.roomStackLayout = new Map();
    let cumulativeY = naturalHeadroom * fitFactor;
    for (const room of rooms) {
      const cellSize = room.mapData.cellSize;
      const scale = (boxWidth / (room.mapData.cols * cellSize)) * fitFactor;
      const effectiveRows = this._roomEffectiveRows(room.mapData, room.layers);
      const widthPx = room.mapData.cols * cellSize * scale;
      const heightPx = effectiveRows * cellSize * scale;
      const xOffset = (boxWidth - widthPx) / 2;
      this.roomStackLayout.set(room.mapData.id, { cumulativeY, widthPx, heightPx, xOffset, scale });
      cumulativeY += heightPx;
    }

    this.canvas.width = boxWidth;
    this.canvas.height = boxHeight; // exactly the viewport — the whole point is no scrolling
    this.sceneWrap.scrollTop = 0;

    const activeLayout = this.roomStackLayout.get(this.mapData.id);
    this.scale = activeLayout.scale;
    this.roomWidthPx = activeLayout.widthPx;
    this.roomHeightPx = activeLayout.heightPx;
    this.offsetX = activeLayout.xOffset;
    this.offsetY = activeLayout.cumulativeY;
  }

  /**
   * Toggled by the −/+ controls (see _buildDom) — true shows the whole
   * discovered base at once (_resizeCanvasOverview), false is the normal
   * camera-follow single-room view (_resizeCanvasRoomFollow). Forced back
   * to false the moment any party member is in combat (see _update).
   */
  _setOverview(value) {
    if (!this._roomMode) return;
    this._overview = value;
    this._resizeCanvas();
  }

  /**
   * Draws every previously-discovered room OTHER than the currently active
   * one — background/midground/floor only, no doors/enemies/characters
   * (those stay live only in the active room's own translate block — see
   * _render) — so the whole base stays visible as a Fallout-Shelter-style
   * cross-section while you're elsewhere in it, instead of vanishing the
   * moment you leave. Drawn before the active room's own layers so it
   * never overlaps/overdraws them (different Y slots anyway, but the
   * active room should still "win" if anything ever lines up). Each
   * room's own widthPx/xOffset (see _resizeCanvasOverview) keeps it
   * correctly centred and proportioned to fit the whole base on screen,
   * same as the active room. Only ever called in overview mode — see
   * _render.
   */
  _renderRoomStackBackdrop() {
    if (!this.discoveredRooms || this.discoveredRooms.size <= 1) return;
    const ctx = this.ctx;
    const canvasW = this.canvas.width;

    for (const [roomId, entry] of this.discoveredRooms) {
      if (roomId === this.mapData.id) continue;
      const layout = this.roomStackLayout?.get(roomId);
      if (!layout) continue;

      // Clipped to exactly this room's own slot — aspect-preserving art
      // (see _renderParallaxLayers) can come out taller than the slot's
      // own grid-row height when a layer's real proportions are far from
      // the grid's own aspect ratio, and without this it would spill
      // upward into whichever room is stacked above it instead of just
      // being cropped at the ceiling.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, layout.cumulativeY, canvasW, layout.heightPx);
      ctx.clip();

      for (const name of ['background', 'midground']) {
        const img = entry.layers[name];
        if (img && img.complete && img.naturalWidth > 0) {
          const drawH = layout.widthPx * (img.naturalHeight / img.naturalWidth);
          const drawY = layout.cumulativeY + layout.heightPx - drawH;
          ctx.drawImage(img, layout.xOffset, drawY, layout.widthPx, drawH);
        }
      }
      const floorImg = entry.layers.floor;
      if (floorImg && floorImg.complete && floorImg.naturalWidth > 0) {
        const cellSize = entry.mapData.cellSize;
        const floorRow = entry.mapData.spawnPoint.row;
        const stripH = cellSize * layout.scale * 1.6;
        const y = layout.cumulativeY + (floorRow + 1) * cellSize * layout.scale - stripH * 0.55;
        ctx.drawImage(floorImg, layout.xOffset, y, layout.widthPx, stripH);
      }
      ctx.restore();
    }
  }

  /**
   * Draws one or more of the *active* room's parallax layers (background/
   * midground/foreground — see _buildRoomLayers). Drawn at this room's own
   * widthPx/xOffset — the full camera-pan width in the normal follow view
   * (_resizeCanvasRoomFollow), or the shrunk, centred overview size
   * (_resizeCanvasOverview) — so overview shrinks the art as one piece
   * instead of stretching it. Other, previously-visited rooms are drawn
   * separately (overview only) — see _renderRoomStackBackdrop.
   */
  _renderParallaxLayers(names) {
    const layers = this.roomLayers;
    if (!layers) return;
    const ctx = this.ctx;

    // In overview mode the active room occupies a slot in the stack just
    // like every other discovered room (see _renderRoomStackBackdrop) —
    // clip to it so this room's own aspect-preserving art (below) can't
    // spill into whichever room is stacked above it, same reasoning as
    // there. Not applied in the normal follow view, where there's no
    // stack to spill into and the room is free to extend past its own
    // grid-row height if its art is naturally taller.
    if (this._overview) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, this.offsetY, this.canvas.width, this.roomHeightPx);
      ctx.clip();
    }

    for (const name of names) {
      const img = layers[name];
      if (!img || !(img.complete && img.naturalWidth > 0)) continue;

      // Height comes from the image's OWN aspect ratio at the room's full
      // width, not forced to fill roomHeightPx (= the grid's own row
      // count) regardless of what the source art actually looks like —
      // every room's art has different real proportions (a wide, short
      // foreground strip vs a taller background), and force-stretching to
      // whatever aspect the grid happens to be (cols/rows) distorted
      // anything that didn't already happen to match it, worst on the
      // layer furthest from that ratio. Bottom-anchored within the room's
      // vertical slot — matches how every layer was authored, floor at
      // the bottom — so any leftover gap (a shorter-than-the-row-count
      // image) falls at the ceiling end, never at the floor.
      const drawH = this.roomWidthPx * (img.naturalHeight / img.naturalWidth);
      const drawY = this.offsetY + this.roomHeightPx - drawH;

      if (name === 'foreground') {
        // The foreground art (pipe/cable clusters, see
        // game/assets/scenes/*/foreground.png) is heaviest right at its own
        // left/right edges, which — now that every room fills the full
        // viewport width — land right at the screen's own edges, where
        // they'd otherwise block a big chunk of the view. Faded out here in
        // screen space so it eases off toward both edges of the viewport,
        // without touching the source art.
        this._renderForegroundFaded(img, this.offsetX, this.roomWidthPx, this.canvas.width, drawY, drawH);
        continue;
      }

      ctx.drawImage(img, this.offsetX, drawY, this.roomWidthPx, drawH);
    }

    if (this._overview) ctx.restore();
  }

  /**
   * Draws the foreground layer through a horizontal fade mask so its own
   * heavy left/right edges ease out toward the viewport's edges instead of
   * showing at full strength — see the comment in _renderParallaxLayers.
   * Rendered into an offscreen buffer first so the fade (applied via
   * destination-in) only erases this layer's own pixels, not whatever's
   * already drawn on the main canvas underneath it.
   */
  _renderForegroundFaded(img, drawX, drawW, canvasW, drawY, drawH) {
    const canvasH = this.canvas.height;
    if (!this._fgFadeCanvas) {
      this._fgFadeCanvas = document.createElement('canvas');
      this._fgFadeCtx = this._fgFadeCanvas.getContext('2d');
    }
    if (this._fgFadeCanvas.width !== canvasW || this._fgFadeCanvas.height !== canvasH) {
      this._fgFadeCanvas.width = canvasW;
      this._fgFadeCanvas.height = canvasH;
    }
    const fctx = this._fgFadeCtx;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, canvasW, canvasH);
    fctx.drawImage(img, drawX, drawY, drawW, drawH);

    // Fully transparent right at each screen edge, back to fully opaque by
    // FOREGROUND_FADE_FRACTION of the viewport width in — tweak that one
    // constant to fade a bigger or smaller strip.
    const fadeW = canvasW * FOREGROUND_FADE_FRACTION;
    const gradient = fctx.createLinearGradient(0, 0, canvasW, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(Math.min(1, fadeW / canvasW), 'rgba(0,0,0,1)');
    gradient.addColorStop(Math.max(0, 1 - fadeW / canvasW), 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.globalCompositeOperation = 'destination-in';
    fctx.fillStyle = gradient;
    fctx.fillRect(0, 0, canvasW, canvasH);

    this.ctx.drawImage(this._fgFadeCanvas, 0, 0);
  }

  /**
   * The floor grate texture lives in the *gameplay* layer (see the task's
   * layer order: Background, Midground, Gameplay, Heroes/Monsters,
   * Foreground) since it's the ground characters actually walk on — drawn
   * inside the same ctx.translate(offsetX, offsetY) block as interactables/
   * characters below, so it always tracks 1:1 with them instead of having
   * its own parallax factor.
   */
  _renderRoomFloor() {
    if (!this._roomMode) return;
    const img = this.roomLayers?.floor;
    if (!img || !(img.complete && img.naturalWidth > 0)) return;
    const ctx = this.ctx;
    const cellSize = this.mapData.cellSize;
    const floorRow = this.mapData.spawnPoint.row;
    const stripH = cellSize * this.scale * 1.6;
    const y = (floorRow + 1) * cellSize * this.scale - stripH * 0.55;
    ctx.drawImage(img, 0, y, this.roomWidthPx, stripH);
  }

  _bindInput() {
    this.canvas.addEventListener('pointerdown', (e) => this._onTap(e));
  }

  _onTap(e) {
    if (this.mode === 'worldmap') {
      this._onWorldMapTap(e);
      return;
    }

    // Overview mode (see _setOverview) shows the whole base at once — but
    // only taps that land on some OTHER, non-active room are intercepted
    // to send the party there (see _onOverviewTap); a tap inside the
    // active room's own slot falls straight through to the normal
    // movement/interaction handling below instead, using that room's own
    // (already-active) scale/offset — so the party stays fully
    // controllable while zoomed out, not just clickable-to-travel.
    if (this._roomMode && this._overview) {
      const activeLayout = this.roomStackLayout?.get(this.mapData.id);
      const rect = this.canvas.getBoundingClientRect();
      const tapY = e.clientY - rect.top;
      const inActiveRoom =
        activeLayout && tapY >= activeLayout.cumulativeY && tapY < activeLayout.cumulativeY + activeLayout.heightPx;
      if (!inActiveRoom) {
        this._onOverviewTap(e);
        return;
      }
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
   * Height: from the floor tile it's standing on up up to whichever is
   * taller — the ceiling of this room (the contiguous run of walkable tiles
   * above it in the same column, for the old multi-row-tall floor-stack
   * interiors) or the sprite's own rendered height (drawH, same math as
   * _renderEnemies). Room-mode scenes (see game/map/scenes/*.json) only mark
   * their single floor row walkable — movement is horizontal-only there —
   * so the ceiling-climb alone collapsed to a one-tile sliver right at the
   * enemy's feet, well short of the visibly tall sprite standing above it;
   * flooring the height at drawH keeps the tap target covering the whole
   * sprite in both room modes instead of just the old floor-stack one.
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
    const bottom = (enemy.position.row + 1) * cellSize;
    const top = Math.min(ceilingRow * cellSize, bottom - drawH);

    return {
      left: centerX - drawW / 2,
      right: centerX + drawW / 2,
      top,
      bottom
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
    const character = this._activeSelectedCharacter();
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
    const character = this._activeSelectedCharacter();
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
   * CombatSystem.INNATE_ATTACK (the built-in energy gauntlet, see
   * CombatSystem.js) instead of refusing the order — a settler can always
   * fire back.
   */
  _commandAttack(enemy) {
    const character = this._activeSelectedCharacter();
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
    const character = this._activeSelectedCharacter();
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

        this._toast(`${character.name} взломала дверь: ${interactable.label}`);

        // Same "ask before actually switching floors" gate as the item
        // unlock path in _performInteractableInteraction — a hacked door
        // leading to another level's file shouldn't behave any differently
        // just because it was opened by Ольга instead of a key card.
        if (interactable.leadsToFile) this._confirmLevelTransition(interactable);
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

    this.constructionUI.showLockedInfo(
      interactable,
      () => {
        const result = this.constructionSystem.tryUnlock(interactable, this.partyInventory);
        if (result.ok) {
          this._toast(`Открыто: ${interactable.label}`);
          this.constructionUI.hide();
          if (interactable.leadsToFile) this._confirmLevelTransition(interactable);
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
   * state and reloads that level's enemies, and drops the whole party at the
   * door on the new floor that actually leads back to the floor they just
   * left (see _spawnPointFor) rather than always the same fixed point —
   * going down through the door on the left should put you at the door on
   * the left below, and same for the right. Used for door_01 →
   * bunker_level_-2 today, but works for any leadsToFile door in either
   * direction (see door_up_01/door_B/door_up_02).
   *
   * The new floor's art is registered into the persistent stack (see
   * _registerFloor) rather than replacing the previous floor's — it stays
   * attached below (or above) it in the world — and the view jumps straight
   * to the new floor instantly, no slide/tween, since that's where play
   * continues.
   */
  /**
   * Tapping a room in overview mode (see _setOverview) sends the party
   * there — walking to the connecting door and confirming the transition
   * exactly like a normal door tap would, not an instant jump — see
   * _travelToRoom. Figures out which room was tapped from its vertical
   * slot in the (already fully-visible, unscrolled) overview layout.
   * Tapping the room the party is already in does nothing — it does NOT
   * zoom back in on its own; only "Приблизить" is allowed to change the
   * zoom, per explicit request that nothing else ever should.
   */
  _onOverviewTap(e) {
    const rect = this.canvas.getBoundingClientRect();
    const tapY = e.clientY - rect.top;
    for (const [roomId, layout] of this.roomStackLayout ?? []) {
      if (tapY < layout.cumulativeY || tapY >= layout.cumulativeY + layout.heightPx) continue;
      if (roomId !== this.mapData.id) this._travelToRoom(roomId);
      return;
    }
  }

  /**
   * Moves the party to a previously-discovered room from overview mode
   * (see _onOverviewTap) — not an instant jump, and not limited to
   * directly-connected rooms either: finds the shortest chain of doors
   * connecting here to there (_findRoomPath) and walks it one hop at a
   * time via the normal walk-to-the-door-then-confirm flow
   * (_onInteractableTapped/_performInteractableInteraction) a manual door
   * tap would use, continuing to the next door automatically each time a
   * switch completes (see _continueTravelQueue, called from
   * _switchLevel) until the party actually reaches the tapped room.
   *
   * Deliberately does NOT turn overview off — the party walks through
   * every room along the way while the player can still see the whole
   * base; only "Приблизить" (see _setOverview) is allowed to zoom back
   * in, never a side effect of giving an order.
   */
  _travelToRoom(roomId) {
    const path = this._findRoomPath(this.mapData.id, roomId);
    if (!path || path.length < 2) return; // no known route through discovered rooms
    this._travelQueue = path.slice(1); // every room still left to walk through, in order
    this._continueTravelQueue();
  }

  /**
   * Finds the shortest chain of rooms connecting `fromRoomId` to
   * `toRoomId`, using only doors belonging to rooms already in
   * this.discoveredRooms (exactly what's visible/tappable in the overview
   * anyway) — a plain breadth-first search over each room's own door
   * interactables. Returns an array of room ids from `fromRoomId` to
   * `toRoomId` inclusive (e.g. ['reactor_room_01', 'technical_bay_01',
   * 'cryo_room_01']), or null if no such chain exists yet.
   */
  _findRoomPath(fromRoomId, toRoomId) {
    if (fromRoomId === toRoomId) return [fromRoomId];
    const visited = new Set([fromRoomId]);
    const queue = [[fromRoomId]];
    while (queue.length > 0) {
      const path = queue.shift();
      const entry = this.discoveredRooms.get(path[path.length - 1]);
      if (!entry) continue;
      for (const it of entry.mapData.interactables) {
        if (it.type !== 'door' || !it.leadsTo || visited.has(it.leadsTo)) continue;
        const nextPath = [...path, it.leadsTo];
        if (it.leadsTo === toRoomId) return nextPath;
        visited.add(it.leadsTo);
        queue.push(nextPath);
      }
    }
    return null;
  }

  /**
   * Walks toward the next room in this._travelQueue (set by
   * _travelToRoom) — one door/hop per call. _switchLevel calls this again
   * right after finishing each switch, so a multi-room trip keeps walking
   * through every room along the chosen route until the queue is empty
   * (the party has actually arrived), rather than skipping straight to
   * the final destination. A no-op whenever there's no pending trip.
   */
  _continueTravelQueue() {
    if (!this._travelQueue || this._travelQueue.length === 0) return;
    const nextRoomId = this._travelQueue[0];
    const door = this.mapData.interactables.find(
      (it) => it.type === 'door' && it.leadsTo === nextRoomId && it.leadsToFile
    );
    if (!door) {
      this._travelQueue = null; // route broken somehow — stop rather than get stuck retrying
      return;
    }
    this._travelQueue = this._travelQueue.slice(1);
    this._onInteractableTapped(door, { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
  }

  async _switchLevel(fileUrl, levelId) {
    if (this._switchingLevel) return;
    this._switchingLevel = true;
    try {
      const cameFromLevelId = this.mapData.id;

      this.levelCache = this.levelCache ?? new Map();
      let mapData = this.levelCache.get(fileUrl);
      if (!mapData) {
        mapData = await fetchJson(fileUrl);
        this.levelCache.set(fileUrl, mapData);
      }

      this.mapData = mapData;
      this._roomMode = !!mapData.parallax;
      if (this._roomMode) {
        // Adds this room to the persistent stack if it's new (first ever
        // visit), or just reuses its existing entry if the party's been
        // here before — either way the room they're LEAVING stays in
        // discoveredRooms too, so it keeps showing in the background (see
        // _renderRoomStackBackdrop) instead of disappearing.
        const entry = this._registerRoom(mapData, fileUrl);
        this.roomLayers = entry.layers;
      } else {
        this._registerFloor(mapData);
      }
      this.enemies = await this._loadEnemies(mapData);
      this._loadEnemySprites();

      this.interactableStates = new Map();
      for (const it of this.mapData.interactables) {
        this.interactableStates.set(`${it.col},${it.row}`, it);
      }
      this.pathfinder = new PathfindingSystem(this.mapData.grid, this.interactableStates);

      const spawn = this._spawnPointFor(this.mapData, cameFromLevelId);
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
      // Continues a multi-room overview trip (see _travelToRoom) toward its
      // real destination, one door at a time — a no-op if this switch
      // wasn't part of one.
      this._continueTravelQueue();
    } finally {
      this._switchingLevel = false;
    }
  }

  /**
   * Where the party appears on a freshly-loaded floor: right at the door
   * that leads back to the floor they just came from (identified by that
   * door's own `leadsTo` matching the previous floor's id), on the floor
   * row directly below it — same "walk down from the door's row until a
   * room tile" search _interactableHitBounds uses. Left door down puts you
   * at the left door on arrival; right door down puts you at the right
   * door — whichever one actually connects back, not a single fixed point.
   * Falls back to the map's own authored spawnPoint if no such door exists
   * (e.g. nothing leads back — a one-way trip, or an unauthored edge case).
   */
  _spawnPointFor(mapData, cameFromLevelId) {
    const grid = mapData.grid;
    const rows = grid.length;
    const cols = grid[0].length;
    const inRoom = (col, row) =>
      row >= 0 && row < rows && col >= 0 && col < cols && grid[row][col] !== 0;

    const returnDoor = mapData.interactables.find(
      (it) => it.type === 'door' && it.leadsTo === cameFromLevelId
    );
    if (!returnDoor) return mapData.spawnPoint;

    // Movement is horizontal-only, so the map's own spawnPoint row is the
    // one real floor line a character can ever stand on (see
    // _sanitizeCharacterPositions). Landing on the first walkable tile
    // below the door instead — which for a multi-row room is usually a row
    // or two below the door but still well above the real floor — put the
    // party on a row that isn't the floor line, so they'd end up stuck
    // running back and forth right under the door instead of down on the
    // ground like every other character.
    const floorRow = mapData.spawnPoint.row;
    if (!inRoom(returnDoor.col, floorRow)) return mapData.spawnPoint;

    return { col: returnDoor.col, row: floorRow };
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

    const character = this._activeSelectedCharacter();
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
      this.skillsById,
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

  /**
   * Whole-party wipe (every recruited settler down, none left standing) —
   * checked every frame. Mark dying alone doesn't trigger this: he's just
   * one recruited character among however many, same as anyone else — the
   * party keeps going on whoever's still up until literally nobody is.
   * Once it fires, the save is cleared and the game reloads fresh into
   * the cryo-room start (see StartMenu.js's ?restart handling) — same
   * clean slate as "Новая игра", just triggered automatically instead of
   * from the menu.
   */
  _checkPartyWipe() {
    if (this._partyWiped) return;
    if (!this.characters || this.characters.length === 0) return;
    const allDown = this.characters.every((c) => !c.isActive);
    if (!allDown) return;

    this._partyWiped = true;
    this._toast('Отряд погиб... Возвращаемся в криоотсек.');
    setTimeout(() => {
      this.saveSystem.clear();
      window.location.href = window.location.pathname + '?restart=1';
    }, 2500);
  }

  /**
   * "The selected character" for any action that needs exactly one —
   * door/corpse/furniture taps, examine, attack commands, camera focus.
   * Every settler has equal standing, so a dead one never quietly becomes
   * "the" character just for being first in the roster or having been
   * selected before they died: this prefers the actual selection only
   * while it's still someone alive, then falls back to any other living
   * settler, and only reaches for characters[0] if literally everyone is
   * down (which triggers _checkPartyWipe anyway, so it barely matters what
   * this returns at that point). Centralised here instead of repeating
   * "getSelected() ?? characters[0]" at every call site, which is exactly
   * what let a dead Mark silently keep blocking doors/attacks/examine for
   * the rest of the party before this existed.
   */
  _activeSelectedCharacter() {
    const selected = this.characterSystem.getSelected(this.characters);
    if (selected?.isActive) return selected;
    return this.characters.find((c) => c.isActive) ?? this.characters[0] ?? null;
  }

  /**
   * Every settler has equal standing — nobody is "the" controlled
   * character, they're just whoever's currently selected. If that
   * happens to be someone who just died, clear the selection so the very
   * next tap (on the floor, or on another living settler) acts on them
   * normally instead of quietly failing against a corpse — moveTo already
   * refuses on an inactive character, which without this reads as "you
   * can't walk there" when the real issue is who's selected, not where.
   */
  _deselectIfDead() {
    const selected = this.characterSystem.getSelected(this.characters);
    if (selected && !selected.isActive) this.characterSystem.deselect();
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
    // Day/night cycle temporarily disabled — see TEMPERATURE_ENABLED comment
    // above the night-overlay check in _render. gameTime.update() is what
    // actually advances the phase, so leaving it uncalled freezes the game
    // in whatever phase the save/default started in (day) — nothing else
    // reads gameTime.progress right now that this would break. One-line
    // uncomment to bring the cycle back.
    // this.gameTime.update(dt);
    this.movementSystem.update(this.characters, dt);
    this.enemySystem.update(this.enemies, this.characters, dt);
    // The auto-formup below (walking the rest of the squad into a firing
    // line the moment one of them is engaged) only makes sense once the
    // player has actually asked for group control — otherwise it silently
    // overrides "each settler moves independently" the instant a fight
    // starts, which is exactly the bug this guard exists to prevent.
    // Whoever's actually being shot at still fights back on their own —
    // that's plain CombatSystem auto-fire, untouched by this — the only
    // thing skipped here is walking everyone ELSE in to help.
    if (this.followAllParty) {
      this.squadCombatSystem.update(this.characters, this.enemies, this.pathfinder);
    }
    this.movementSystem.update(this.enemies, dt);
    this.combatSystem.update(this.characters, this.enemies, dt);
    this.skillSystem.update(this.characters, this.enemies, dt);

    // Overview mode (see _setOverview) only ever changes because the
    // player pressed "Приблизить"/"Отдалить" — nothing else touches it.
    // Combat used to force it back off automatically; removed on request,
    // since the whole point of pulling out is to look at the base on your
    // own terms, not something the game should override for you.
    if (this._roomMode && !this._overview) this._updateCamera(dt);
    this._checkPartyWipe();
    this._deselectIfDead();
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
      if (this.resourceSystem.provisions <= 5) this.shelterUI.flashLowResource('provisions');
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

    if (this._roomMode) {
      // Other discovered rooms only draw in overview mode (see
      // _setOverview) — the normal camera-follow view shows just the
      // active room, same as it always did before overview existed.
      if (this._overview) this._renderRoomStackBackdrop();
      this._renderParallaxLayers(['background', 'midground']);
    } else {
      this._renderFloorStack();
    }

    // Night darkening overlay tied to GameTime — disabled along with the
    // day/night cycle itself (see _update's commented gameTime.update()).
    // gameTime.isDay stays true the whole time now, so this never fires
    // anyway, but the flag below is the actual on/off switch to flip back
    // when the cycle returns.
    const DAY_NIGHT_ENABLED = false;
    if (DAY_NIGHT_ENABLED && !this.gameTime.isDay) {
      ctx.fillStyle = 'rgba(5,5,20,0.35)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Everything below is authored in the active room/floor's own
    // image-space; translate once so every draw call can keep using
    // col/row * cellSize * scale like before — this.offsetY points at
    // wherever the active room/floor sits in the stacked world, offsetX is
    // the camera pan in the normal follow view (_updateCamera), the
    // overview's own centring offset in overview mode, or 0 for the
    // legacy floor stack.
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);

    if (DEBUG_GRID) this._renderDebugGrid();

    this._renderRoomFloor();
    this._renderSurfaceLabel();
    this._renderInteractables();
    this._renderEnemies();
    this._renderCharacters();
    this._renderRecruits();
    this._renderAttackEffects();

    ctx.restore();

    // Foreground draws last, in screen space (its own parallax factor, not
    // the gameplay translate above) — see the task's layer order: it sits
    // in front of the hero/monsters, same as thick pipes/cables would
    // physically hang between the camera and the room.
    if (this._roomMode) {
      this._renderParallaxLayers(['foreground']);
    }
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
    // Room scenes (see _roomMode) never have a vault-door surface art, so
    // this cosmetic label is old-floor-stack-only.
    if (this._roomMode) return;
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

    let boundLeftCol, boundRightCol;
    if (it.type === 'door') {
      // Doors used to share the wide "roughly a third of the room" zone
      // below with ladders — great for finding the door, but it also meant
      // any movement tap thrown anywhere in that whole chunk of the room
      // got swallowed as "tap the door" instead, so trying to walk a
      // character past a doorway just kept re-snapping them back to it
      // ("stuck in the doorway"). Doors get a small zone hugging just the
      // doorway itself instead, so taps further into the room reach
      // movement (case 4 in _onTap) like normal.
      const doorBand = 1;
      boundLeftCol = Math.max(leftCol, it.col - doorBand);
      boundRightCol = Math.min(rightCol, it.col + doorBand);
    } else {
      // Ladders/other interactables keep the original wide, forgiving zone:
      // roughly a third of the room's width, anchored against whichever
      // wall they're closer to ("весь левый/правый участок").
      const roomWidthTiles = rightCol - leftCol + 1;
      const bandTiles = Math.max(4, Math.round(roomWidthTiles * 0.35));
      if (it.col - leftCol <= rightCol - it.col) {
        boundLeftCol = leftCol;
        boundRightCol = Math.min(rightCol, leftCol + bandTiles);
      } else {
        boundLeftCol = Math.max(leftCol, rightCol - bandTiles);
        boundRightCol = rightCol;
      }
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

      // Doors used to get a small wall-mounted keypad panel drawn beside
      // them here (see removed _renderDoorKeypad) instead of a shine —
      // removed per user request. What's left is only a transient progress
      // bar (see _renderHackProgress) while Ольга is actively hacking one —
      // not a permanent fixture, gone the moment the session ends — plus
      // the same room-shine treatment as everything else below.
      if (it.type === 'door') {
        const session = [...this.hackingSessions.values()].find((s) => s.interactable === it);
        if (session) this._renderHackProgress(it, session, cs);
      }

      // Ladders/other interactables (doors too, now) keep the original room-shine treatment —
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
   * Transient progress bar shown above a door only while a hacking session
   * (see _startHacking/_updateHacking) is actively running against it — a
   * plain labelled bar, not a dial or panel, so it doesn't bring back the
   * permanent per-door chrome that got removed. Positioned just above the
   * hacking character's head (same floor-row-below-the-door search used
   * elsewhere, e.g. _interactableHitBounds) rather than at the door's own
   * high wall tile, since that's where the eye is already looking. Vanishes
   * the instant the session ends, success or interruption alike — it's
   * driven purely by hackingSessions still containing this door.
   */
  _renderHackProgress(it, session, cs) {
    const ctx = this.ctx;
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
    const cx = (it.col + 0.5) * cs;
    const cy = groundY - charDrawH * 1.08; // just above the hacking character's head

    const progress =
      session.requiredMs > 0 ? Math.min(1, (it.hackProgressMs ?? 0) / session.requiredMs) : 0;
    const barW = cs * 1.6;
    const barH = cs * 0.16;

    ctx.save();

    ctx.font = `${Math.max(9, cs * 0.22)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`Взлом… ${Math.round(progress * 100)}%`, cx, cy - barH / 2 - 3);

    ctx.fillStyle = 'rgba(10,12,16,0.75)';
    ctx.fillRect(cx - barW / 2, cy - barH / 2, barW, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - barW / 2, cy - barH / 2, barW, barH);

    ctx.fillStyle = '#6ebeff';
    ctx.fillRect(cx - barW / 2 + 1, cy - barH / 2 + 1, (barW - 2) * progress, barH - 2);

    ctx.restore();
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
      if (!character.isActive) {
        // Dead — plays through the death sprite set once (see
        // Character.setInactive's death is permanent for this character,
        // so there's no "loop"/"return to idle" case to handle) and holds
        // the last frame afterward, right where they fell. _deathAnimStart
        // is stamped here, the first render call that notices them dead,
        // rather than in Character itself, so the clock starts from
        // "first drawn dead" not from whatever tick health hit 0 on.
        // Characters without a dedicated set (see _buildSpriteSet) just
        // keep cycling their last idle pose instead — the grey tint drawn
        // further down is what actually reads as "down" for them.
        const deathFrames = spriteSet.death;
        if (deathFrames?.length) {
          if (character._deathAnimStart == null) character._deathAnimStart = this._now;
          const DEATH_FPS = 8;
          const elapsed = (this._now - character._deathAnimStart) / 1000;
          const frameIndex = Math.min(deathFrames.length - 1, Math.floor(elapsed * DEATH_FPS));
          sprite = deathFrames[frameIndex];
        } else {
          const frameIndex = Math.floor((this._now / 1000) * IDLE_FPS) % spriteSet.idle.length;
          sprite = spriteSet.idle[frameIndex];
        }
      } else if (isMoving) {
        // Moving always wins — a character walking into range cancels any
        // stale "attacking" pose from the previous target, same as examine.
        // runPhase (MovementSystem) is distance-based, not time-based — see
        // its own header comment for why that's what keeps this synced to
        // actual movement speed instead of just wall-clock time.
        const runFrames = directional
          ? (character.facingDir < 0 ? spriteSet.runLeft : spriteSet.runRight)
          : spriteSet.run;
        const frameIndex = Math.floor(character.runPhase ?? 0) % runFrames.length;
        sprite = runFrames[frameIndex];
      } else if (character.combatState === 'attacking' && character.attackAnimRemaining > 0) {
        // Only mid-swing/shot during the brief pulse set right when an
        // attack actually fires (see CombatSystem.update) — otherwise it
        // holds an idle "ready" pose below, so a slow-firing weapon (a
        // revolver, say) doesn't loop the attack animation nonstop while
        // waiting out attackCooldownRemaining (see the reload bar drawn
        // further down).
        const ATTACK_FPS = 12; // plays the 12-frame swing over ~1s (see balance.combat.attackAnimSeconds)
        // Elapsed-since-the-swing-started (not the absolute game clock, which
        // used to make the cycle start mid-frame depending on when the swing
        // happened to fire — see attackAnimDuration) and clamped to the last
        // frame instead of wrapping, so a swing always plays draw→fire→
        // recover in order once and holds on the recovery pose, same idea as
        // the afk fidget below.
        const elapsed = character.attackAnimDuration - character.attackAnimRemaining;
        const frameIndex = Math.min(spriteSet.attack.length - 1, Math.floor(elapsed * ATTACK_FPS));
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
      // Width comes from whichever frame is actually playing right now, at
      // its own native aspect ratio — never squashed or stretched into some
      // other pose's shape. Run/attack/examine art is genuinely a different
      // silhouette than idle (a running stride is wider, examine's raised
      // holo-panel wider still), so the character's on-screen width does
      // shift a bit between poses instead of staying perfectly constant —
      // that's the accepted trade for never rendering squeezed/stretched
      // (see the reference-frame version this replaced, which anchored
      // every pose to idle's own aspect and squeezed run/attack sideways to
      // fit it). Falls back to the character's idle reference frame only if
      // the currently-playing frame itself hasn't finished loading yet.
      const refSprite = sprite.naturalWidth ? sprite : this._referenceSpriteFor(spriteSet);
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
        if (!character.isActive) {
          ctx.globalAlpha = 0.6;
          ctx.filter = 'grayscale(1)';
        }
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

      // Концентрация bar — a second, thinner strip just below the reload
      // bar (or in its usual spot if not currently attacking), only for
      // characters with a skill (see Character.skillId/SkillSystem). Fills
      // up on its own while the character's in the fight; SkillSystem
      // resets it to 0 the instant it fires the skill.
      if (character.skillId) {
        ctx.save();
        const barW = cs * 1.2;
        const barY = groundY - drawH - 11;
        const ratio = character.skillCharge / character.skillChargeMax;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - barW / 2, barY, barW, 3);
        ctx.fillStyle = ratio >= 1 ? '#ffe066' : '#4aa3e0';
        ctx.fillRect(x - barW / 2, barY, barW * ratio, 3);
        ctx.restore();
      }

      // Guardian_shield visual — a soft cyan ring around anyone currently
      // shielded (see Character.shieldRemaining/SkillSystem), so it's clear
      // at a glance why they're taking no damage.
      if (character.shieldRemaining > 0) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#7fe0ff';
        ctx.lineWidth = Math.max(2, cs * 0.06);
        ctx.beginPath();
        ctx.ellipse(x, groundY - drawH * 0.5, drawW * 0.62, drawH * 0.58, 0, 0, Math.PI * 2);
        ctx.stroke();
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
   * A shot is a two-phase VFX: the energy bolt travels from shooter to
   * target playing this.effectSprites.projectile (growing from a spark to a
   * full comet as it flies — see _loadEffectSprites), then holds at the
   * target and plays .impact once (burst growing then fading) before the
   * effect is dropped. Effects are pushed by CombatSystem's onAttack
   * callback (with travelMs already computed from shot distance) and pruned
   * here once travelMs + ATTACK_EFFECT_IMPACT_MS elapses — nothing else
   * references this._attackEffects.
   */
  _renderAttackEffects() {
    const ctx = this.ctx;
    const cs = this.mapData.cellSize * this.scale;
    const now = this._now ?? performance.now();

    this._attackEffects = this._attackEffects.filter(
      (fx) => now - fx.start < fx.travelMs + ATTACK_EFFECT_IMPACT_MS
    );

    for (const fx of this._attackEffects) {
      const elapsed = now - fx.start;
      const fromX = (fx.from.col + 0.5) * cs;
      const fromY = (fx.from.row + 0.5) * cs - cs * 3; // roughly chest height, not feet
      const toX = (fx.to.col + 0.5) * cs;
      const toY = (fx.to.row + 0.5) * cs - cs * 2;
      const facingLeft = toX < fromX;

      let sprite, x, y, drawH;
      if (elapsed < fx.travelMs) {
        const t = elapsed / fx.travelMs;
        const frames = this.effectSprites.projectile;
        sprite = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
        x = lerp(fromX, toX, t);
        y = lerp(fromY, toY, t);
        drawH = cs * 0.9;
      } else {
        const t = (elapsed - fx.travelMs) / ATTACK_EFFECT_IMPACT_MS;
        const frames = this.effectSprites.impact;
        sprite = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
        x = toX;
        y = toY;
        drawH = cs * 1.6;
      }
      if (!sprite.complete || sprite.naturalWidth === 0) continue;
      const drawW = drawH * (sprite.naturalWidth / sprite.naturalHeight);

      ctx.save();
      // Additive blend so the glow lights up against the scene instead of
      // sitting on top of it as a flat sticker — the source art's own soft
      // white haze around each frame all but disappears under 'lighter'.
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(x, y);
      // Source art always points right; mirror it for a shot fired leftward.
      if (facingLeft) ctx.scale(-1, 1);
      ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }

  _save() {
    this.saveSystem.save({
      characters: this.characters.map((c) => c.toSaveData()),
      partyInventory: [...this.partyInventory],
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
  // no-store so a stale browser cache never serves outdated game data
  // (characters, map scenes, items, balance, ...) after a fresh deploy —
  // this bit the project once already (a newly-added character silently
  // missing because the phone's browser kept serving the old
  // characters.json). Small files, fetched a handful of times at
  // load/floor-switch, so skipping the cache costs nothing noticeable.
  const res = await fetch(path, { cache: 'no-store' });
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
