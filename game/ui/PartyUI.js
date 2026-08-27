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
// Selection model: the bottom row is the only interactive control here —
// tapping a slot makes that settler the squad's lead/tank (via
// onSelectLead), and the avatar/pose/stats/ability panel always reflects
// whoever the current lead is.

const SLOT_LIMIT = 5; // mirrors Game.js's MAX_PARTY_SIZE

export class PartyUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'squad-screen hidden';
    this.root.appendChild(this.panel);
  }

  /**
   * @param {Character[]} characters - recruited, in-party settlers (up to SLOT_LIMIT)
   * @param {Map<string, Item>} itemsById
   * @param {Map<string, object>} skillsById - game/data/skills.json entries, for the ability name/description
   * @param {(characterId:string) => void} onSelectLead - fired when a bottom slot is tapped
   * @param {() => void} onClose
   */
  show(characters, itemsById, skillsById, onSelectLead, onClose) {
    this._characters = characters;
    this._itemsById = itemsById;
    this._skillsById = skillsById;
    this._onSelectLead = onSelectLead;
    this._onClose = onClose;

    const squad = characters.slice(0, SLOT_LIMIT);
    const lead = squad.find((c) => c.isTank) ?? squad[0] ?? null;

    this.panel.innerHTML = `
      <div class="squad-frame">
        <button class="squad-hole squad-back-btn" aria-label="Назад"></button>

        <div class="squad-hole squad-avatar-hole ${lead && !lead.isActive ? 'inactive' : ''}">${this._avatarHtml(lead)}</div>
        <div class="squad-hole squad-centre-pose">${this._fullBodyHtml(lead)}</div>

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

    this.panel.classList.remove('hidden');
  }

  /**
   * Fills in just the value half of each baked stat row (Здоровье bar,
   * Раса, СИЛ/ВЫН/ЛОВ/ИНТ/КОНЦ numbers) plus the ability name/description
   * below them — every label and the divider line are part of
   * squad_panel_frame.png. `character` null (nobody recruited yet) leaves
   * every value hole empty rather than showing stale data.
   */
  _statValuesHtml(character) {
    const ratio = character ? Math.max(0, Math.min(1, character.health / 100)) : 0;
    const skill = character?.skillId ? this._skillsById?.get(character.skillId) : null;
    const raceLabel = character ? this._raceLabel(character.race) : '';

    return `
      <div class="squad-hole squad-stat-health"><div class="squad-stat-fill" style="width:${character ? ratio * 100 : 0}%"></div></div>
      <div class="squad-hole squad-stat-race">${raceLabel}</div>
      <div class="squad-hole squad-stat-str">${character ? character.strength : ''}</div>
      <div class="squad-hole squad-stat-end">${character ? character.endurance : ''}</div>
      <div class="squad-hole squad-stat-agi">${character ? character.agility : ''}</div>
      <div class="squad-hole squad-stat-int">${character ? character.intelligence : ''}</div>
      <div class="squad-hole squad-stat-conc">${character ? character.concentration : ''}</div>
      ${skill ? `
        <div class="squad-hole squad-ability-name">${skill.name}</div>
        <div class="squad-hole squad-ability-desc">${skill.description}</div>
      ` : ''}
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
