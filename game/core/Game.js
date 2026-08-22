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

import { GameTime } from './GameTime.js';
import { ResourceSystem } from './ResourceSystem.js';
import { TemperatureSystem } from './TemperatureSystem.js';
import { SaveSystem } from './SaveSystem.js';

import { Character } from '../entities/Character.js';
import { Room } from '../entities/Room.js';

import { ShelterUI } from '../ui/ShelterUI.js';
import { CharacterUI } from '../ui/CharacterUI.js';
import { ConstructionUI } from '../ui/ConstructionUI.js';
import { WorldMapUI } from '../ui/WorldMapUI.js';
import { CharacterRosterUI } from '../ui/CharacterRosterUI.js';
import { showStartMenu } from '../ui/StartMenu.js';

const DEBUG_GRID = false; // flip to true to see the passability grid over the art

class Game {
  async init() {
    const [balance, mapData, roomsData, charactersData] = await Promise.all([
      fetchJson('game/data/balance.json'),
      fetchJson('game/map/bunker-map.json'),
      fetchJson('game/data/rooms.json'),
      fetchJson('game/data/characters.json')
    ]);

    this.balance = balance;
    this.mapData = mapData;

    const save = new SaveSystem().load();
    this.saveSystem = new SaveSystem();

    this.rooms = roomsData.rooms.map((r) => new Room(r));
    this.characters = charactersData.characters.map((c) => new Character(c));

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

    this.movementSystem = new MovementSystem(balance);
    this.characterSystem = new CharacterSystem(balance);
    this.roomSystem = new RoomSystem(this.rooms);
    this.resourceSystem = new ResourceSystem(balance, save?.resources);
    this.temperatureSystem = new TemperatureSystem(balance);
    this.constructionSystem = new ConstructionSystem(this.resourceSystem, this.roomSystem);
    this.expeditionSystem = new ExpeditionSystem();
    this.worldSystem = new WorldSystem();
    this.gameTime = new GameTime(balance, save?.gameTime);

    this._buildDom();
    this._loadBunkerImage();
    this._loadCharacterSprites();
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
  }

  /**
   * Snaps any character standing on a tile that isn't walkable in the
   * *current* map back to the map's spawn point. Guards against exactly the
   * "flying outside the bunker" bug: a saved position from an older map
   * layout landing on what is now empty scenery (or off-grid entirely).
   */
  _sanitizeCharacterPositions() {
    const spawn = this.mapData.spawnPoint;
    for (const character of this.characters) {
      if (!this.pathfinder.isWalkable(character.position.col, character.position.row)) {
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
      ]
    };
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

    // 2) Tapped an interactable (door/ladder)?
    const interactable = this.interactableStates.get(`${col},${row}`);
    if (interactable) {
      this._onInteractableTapped(interactable);
      return;
    }

    // 3) Otherwise, move the selected character there.
    const selected = this.characterSystem.getSelected(this.characters);
    if (selected) {
      const moved = this.movementSystem.moveTo(selected, { col, row }, this.pathfinder);
      if (!moved) this._toast('Туда пройти нельзя.');
    }
  }

  _selectCharacter(character) {
    this.characterSystem.select(character.id);
    this.characterUI.show(
      character,
      this.rooms,
      (roomId) => {
        if (roomId) this.roomSystem.assignWorker(roomId, character.id, this.characters);
        else this.roomSystem.unassignWorker(character.id, this.characters);
      },
      () => this.characterSystem.deselect()
    );
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
    this._renderCharacters();

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
    for (const it of this.mapData.interactables) {
      const x = it.col * cs;
      const spanRows = it.type === 'ladder' ? 8 : 1;
      const y = it.row * cs;
      ctx.save();
      ctx.strokeStyle = it.locked ? '#c0392b' : '#2ecc71';
      ctx.lineWidth = 3;
      ctx.setLineDash(it.type === 'ladder' ? [6, 4] : []);
      ctx.strokeRect(x, y, cs, cs * spanRows);
      ctx.restore();
    }
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
      const isSelected = this.characterSystem.selectedId === character.id;

      const isMoving = character.path && character.path.length > 0;
      let sprite;
      if (character.animState === 'examine' && !isMoving) {
        sprite = this.sprites.examine;
      } else if (isMoving) {
        const RUN_FPS = 7;
        const frameIndex = Math.floor((this._now / 1000) * RUN_FPS) % this.sprites.run.length;
        sprite = this.sprites.run[frameIndex];
      } else {
        sprite = this.sprites.idle;
      }
      const drawH = cs * 3.6;
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

        if (isSelected) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 2;
          ctx.strokeRect(-drawW / 2, 0, drawW, drawH);
        }
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

  _save() {
    this.saveSystem.save({
      characters: this.characters.map((c) => c.toSaveData()),
      rooms: this.rooms.map((r) => r.toSaveData()),
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
