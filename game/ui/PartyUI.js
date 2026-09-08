// PartyUI.js
// Full-screen "Отряд" screen opened from CharacterRosterUI's party button.
//
// Skinned entirely from a single reference image
// (game/assets/ui/squad_panel_frame.png) — every static label/icon is
// baked in (back arrow, Здоровье/Раса/СИЛ/ВЫН/ЛОВ/ИНТ/КОНЦ labels, the
// bottom row's 5 cells, the add-squad icon); the regions that need to
// show LIVE data (avatar photo, full-body pose, stat values, ability
// text, bottom-row thumbnails) were cut out of that image as transparent
// holes, and every element below is an absolutely-positioned overlay
// lined up with one specific hole — see the top of each _*Html method for
// which one. Positions are in % of the frame image (1536x1024), so they
// stay aligned regardless of screen size. Matches an exact reference
// mockup the user supplied, not a general-purpose layout — don't add
// elements that aren't in that reference without checking first.
//
// Vehicle integration (ТЗ п.6): the centre-pose hole shows the lead's
// assigned vehicle (see VehicleSystem) instead of the hero's own
// full-body art whenever they're leading one — "робот должен
// отображаться посередине рядом с героем". The vehicle-picker button
// below the avatar (NOT part of the original reference image — there's
// no baked hole for it, so it's drawn with its own small background/
// border) lets you cycle which vehicle this lead pilots.
//
// Selection model: the bottom row makes a settler the squad's lead/tank
// (via onSelectLead); the vehicle picker changes which vehicle the
// CURRENT lead pilots (via onSelectVehicle). The avatar/pose/stats/
// ability panel always reflects whoever the current lead is.

const SLOT_LIMIT = 5; // mirrors Game.js's MAX_PARTY_SIZE

export class PartyUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'squad-screen hidden';
    this.root.appendChild(this.panel);
  }

  /**
   * @param {object} params
   * @param {Character[]} params.characters - recruited, in-party settlers (up to SLOT_LIMIT)
   * @param {Map<string, Item>} params.itemsById
   * @param {VehicleSystem} [params.vehicleSystem]
   * @param {Map<string, object>} [params.vehicleDefsById] - game/data/vehicles.json entries, keyed by id
   * @param {(characterId:string) => void} params.onSelectLead - fired when a bottom slot is tapped
   * @param {(characterId:string) => void} [params.onSelectVehicle] - fired when the vehicle picker is tapped
   * @param {() => void} params.onClose
   */
  show({ characters, itemsById, vehicleSystem, vehicleDefsById, onSelectLead, onSelectVehicle, onClose }) {
    this._characters = characters;
    this._itemsById = itemsById;
    this._vehicleSystem = vehicleSystem ?? null;
    this._vehicleDefsById = vehicleDefsById ?? new Map();
    this._onSelectLead = onSelectLead;
    this._onSelectVehicle = onSelectVehicle;
    this._onClose = onClose;

    const squad = characters.slice(0, SLOT_LIMIT);
    const lead = squad.find((c) => c.isTank) ?? squad[0] ?? null;
    const leadVehicle = lead ? this._vehicleFor(lead.id) : null;

    this.panel.innerHTML = `
      <div class="squad-frame">
        <button class="squad-hole squad-back-btn" aria-label="Назад"></button>

        <div class="squad-hole squad-avatar-hole ${lead && !lead.isActive ? 'inactive' : ''}">${this._avatarHtml(lead)}</div>
        ${this._vehiclePickerHtml(lead, leadVehicle)}
        <div class="squad-hole squad-centre-pose">${this._centrePoseHtml(lead, leadVehicle)}</div>

        ${this._statValuesHtml(lead)}

        <div class="squad-bottom-row">
          ${squad.map((c, i) => this._slotHtml(c, c.id === lead?.id, i)).join('')}
        </div>
        <button class="squad-hole squad-add-slot" aria-label="Создать отряд"></button>
      </div>
    `;

    this.panel.querySelector('.squad-back-btn').addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    this.panel.querySelectorAll('.squad-slot[data-id]').forEach((el) => {
      el.addEventListener('click', () => onSelectLead?.(el.dataset.id));
    });

    this.panel.querySelector('.squad-vehicle-picker')?.addEventListener('click', () => {
      if (lead) onSelectVehicle?.(lead.id);
    });

    this.panel.classList.remove('hidden');
  }

  /** The vehicle (if any) `characterId` currently leads — see VehicleSystem.squad/Vehicle.leaderId. */
  _vehicleFor(characterId) {
    return this._vehicleSystem?.squad.find((v) => v.leaderId === characterId) ?? null;
  }

  /**
   * Fills in just the value half of each baked stat row (Здоровье bar,
   * Раса, СИЛ/ВЫН/ЛОВ/ИНТ/КОНЦ numbers) plus the ability name/description
   * below them — every label and the divider line are part of
   * squad_panel_frame.png. `character` null (nobody recruited yet) leaves
   * every value hole empty rather than showing stale data.
   *
   * TODO(hero rework): the old fixed attribute set (СИЛ/ВЫН/ЛОВ/ИНТ/КОНЦ)
   * these five holes were baked in the frame art for is gone — heroes now
   * carry an open-ended Stats block (see Character.stats/StatsSystem.js)
   * whose keys aren't fixed to exactly five, so they don't map cleanly onto
   * this specific frame image any more. Left blank for now rather than
   * showing mismatched numbers; revisit once the new hero stat display is
   * actually designed. Same for the ability name/description block, which
   * depended on the removed skillId/SkillSystem — will come back once the
   * new ability data format exists.
   */
  _statValuesHtml(character) {
    const ratio = character ? Math.max(0, Math.min(1, character.health / (character.stats?.get('maxHealth') || 100))) : 0;
    const raceLabel = character ? this._raceLabel(character.race) : '';

    return `
      <div class="squad-hole squad-stat-health"><div class="squad-stat-fill" style="width:${character ? ratio * 100 : 0}%"></div></div>
      <div class="squad-hole squad-stat-race">${raceLabel}</div>
      <div class="squad-hole squad-stat-str"></div>
      <div class="squad-hole squad-stat-end"></div>
      <div class="squad-hole squad-stat-agi"></div>
      <div class="squad-hole squad-stat-int"></div>
      <div class="squad-hole squad-stat-conc"></div>
    `;
  }

  /**
   * UI-only display text for a character's race (see Character.race /
   * game/systems/InteractionSystem.js) — purely cosmetic label mapping,
   * doesn't feed back into game logic. Falls back to the raw stored value
   * (capitalised) for any race this list hasn't caught up with yet, so a
   * newly-added race in characters.json still shows *something* sensible
   * here without needing a matching UI change first.
   */
  _raceLabel(race) {
    const known = { human: 'Человек' };
    if (known[race]) return known[race];
    return race ? race.charAt(0).toUpperCase() + race.slice(1) : '';
  }

  _avatarHtml(character) {
    if (!character) return '';
    return character.avatar
      ? `<img src="${character.avatar}" alt="">`
      : `<div class="squad-avatar-fallback">${character.name.charAt(0).toUpperCase()}</div>`;
  }

  /** Full-body render for the centre pose hole — the character's own idle sprite (see Character.fullBodyArt), or nothing if it hasn't got one yet. */
  _fullBodyHtml(character) {
    if (!character?.fullBodyArt) return '';
    return `<img class="squad-pose-img" src="${character.fullBodyArt}" alt="">`;
  }

  /**
   * Centre-pose content: the lead's assigned vehicle (a static frame from
   * its own walk-cycle art — see game/data/vehicles.json) if they're
   * leading one, since "техника заменяет героя" applies here too, same as
   * on the bunker map. Falls back to the hero's own full-body art when
   * they aren't currently piloting anything.
   */
  _centrePoseHtml(character, vehicle) {
    if (vehicle) {
      const def = this._vehicleDefsById.get(vehicle.defId);
      const frame = def?.sprites?.runRight?.[0] ?? def?.sprites?.runLeft?.[0] ?? null;
      if (frame) return `<img class="squad-pose-img" src="${frame}" alt="">`;
    }
    return this._fullBodyHtml(character);
  }

  /**
   * Vehicle picker — sits just below the avatar hole. NOT part of the
   * original reference image (squad_panel_frame.png has no cutout here),
   * so it draws its own small background/border rather than sitting on a
   * transparent hole like everything else on this screen. Tapping it
   * cycles the current lead through every known vehicle definition (see
   * Game._cycleLeaderVehicle) — "слева под иконкой герою, чтобы его можно
   * было выбрать или поменять на другую технику".
   */
  _vehiclePickerHtml(character, vehicle) {
    if (!character) return '';
    const def = vehicle ? this._vehicleDefsById.get(vehicle.defId) : null;
    const icon = def?.sprites?.runRight?.[0] ?? def?.sprites?.runLeft?.[0] ?? null;
    const label = def ? def.name : 'Нет техники';

    return `
      <button class="squad-hole squad-vehicle-picker" aria-label="Сменить технику">
        <div class="squad-vehicle-icon">${icon ? `<img src="${icon}" alt="">` : '—'}</div>
        <div class="squad-vehicle-label">${label}</div>
      </button>
    `;
  }

  _slotHtml(character, isLead, index) {
    return `
      <button class="squad-slot squad-slot-${index} ${isLead ? 'active' : ''} ${!character.isActive ? 'inactive' : ''}" data-id="${character.id}">
        <div class="squad-slot-avatar">${this._avatarHtml(character)}</div>
      </button>
    `;
  }

  hide() {
    this.panel.classList.add('hidden');
  }

  get isVisible() {
    return !this.panel.classList.contains('hidden');
  }
}

PartyUI.SLOT_LIMIT = SLOT_LIMIT;
