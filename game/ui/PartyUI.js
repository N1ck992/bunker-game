// PartyUI.js
// Full-screen "Отряд" screen opened from CharacterRosterUI's party button.
//
// Skinned entirely from a single reference image
// (game/assets/ui/squad_panel_frame.png) rather than CSS-drawn chrome —
// see .squad-frame in style.css. That art already has every static
// label/icon baked in (back arrow, Здоровье/СИЛ/ВЫН/ЛОВ/ИНТ labels, the
// vehicle/flashlight glyphs, the bottom row's 5 cells, the add-squad
// icon); the regions that need to show LIVE data (avatar photo, full-body
// pose, stat values, bottom-row thumbnails) were cut out of that image as
// transparent holes, and every element below is an absolutely-positioned
// overlay lined up with one specific hole — see the top of each _*Html
// method for which one. Positions are in % of the frame image
// (1536x1024), so they stay aligned regardless of screen size.
//
// Two-level selection (unchanged from before the re-skin):
//  1. Bottom row (one slot per squad member) — tapping a slot makes that
//     settler the squad's lead/tank (via onSelectLead) and resets the
//     left column back to "hero" view.
//  2. Left column's avatar/vehicle holes are tappable and toggle what the
//     centre pose and right-hand stat values show — the hero themselves,
//     or their vehicle. Purely a viewing toggle, never touches the lead.
//     The right-hand panel's labels are baked into the art as
//     hero-specific (Здоровье/СИЛ/ВЫН/ЛОВ/ИНТ), so vehicle view leaves
//     those value slots empty rather than mislabeling item stats into
//     them — see _statValuesHtml.

const SLOT_LIMIT = 5; // mirrors Game.js's MAX_PARTY_SIZE

export class PartyUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'squad-screen hidden';
    this.root.appendChild(this.panel);
    this._viewMode = 'hero';
    this._lastLeadId = null;
  }

  /**
   * @param {Character[]} characters - recruited, in-party settlers (up to SLOT_LIMIT)
   * @param {Map<string, Item>} itemsById
   * @param {(characterId:string) => void} onSelectLead - fired when a bottom slot is tapped
   * @param {() => void} onClose
   */
  show(characters, itemsById, onSelectLead, onClose) {
    this._characters = characters;
    this._itemsById = itemsById;
    this._onSelectLead = onSelectLead;
    this._onClose = onClose;

    const squad = characters.slice(0, SLOT_LIMIT);
    const lead = squad.find((c) => c.isTank) ?? squad[0] ?? null;

    if (lead?.id !== this._lastLeadId) this._viewMode = 'hero';
    this._lastLeadId = lead?.id ?? null;

    const vehicleItem = lead ? itemsById?.get(lead.vehicle) : null;
    const gadgetItem = lead ? itemsById?.get(lead.gadget) : null;

    this.panel.innerHTML = `
      <div class="squad-frame">
        <button class="squad-hole squad-back-btn" aria-label="Назад"></button>

        <button class="squad-hole squad-select-avatar ${this._viewMode === 'hero' ? 'active' : ''}" data-view="hero" ${lead ? '' : 'disabled'}>
          ${this._avatarHtml(lead)}
        </button>
        <button class="squad-hole squad-select-vehicle-side ${this._viewMode === 'vehicle' ? 'active' : ''}" data-view="vehicle" ${lead ? '' : 'disabled'}>
          ${this._iconHtml(vehicleItem, '🚙')}
        </button>
        <div class="squad-hole squad-gadget-side">${this._iconHtml(gadgetItem, '🔦')}</div>

        <div class="squad-hole squad-centre-pose">
          ${this._viewMode === 'hero' ? this._fullBodyHtml(lead) : this._vehicleArtHtml(vehicleItem)}
        </div>
        <div class="squad-hole squad-vehicle-mid">${this._iconHtml(vehicleItem, '🚙')}</div>
        <div class="squad-hole squad-gadget-mid">${this._iconHtml(gadgetItem, '🔦')}</div>

        ${this._statValuesHtml(this._viewMode === 'hero' ? lead : null)}

        <div class="squad-bottom-row">
          ${squad.map((c, i) => this._slotHtml(c, itemsById, c.id === lead?.id, i)).join('')}
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

    this.panel.querySelectorAll('[data-view]').forEach((el) => {
      el.addEventListener('click', () => {
        this._viewMode = el.dataset.view;
        this.show(this._characters, this._itemsById, this._onSelectLead, this._onClose);
      });
    });

    this.panel.classList.remove('hidden');
  }

  /**
   * Fills in just the value half of each baked stat row (Здоровье bar +
   * СИЛ/ВЫН/ЛОВ/ИНТ numbers) — the labels themselves are part of
   * squad_panel_frame.png. `character` null (vehicle view, or nobody
   * recruited yet) leaves every value hole empty rather than showing
   * mismatched data in hero-labelled slots.
   */
  _statValuesHtml(character) {
    const ratio = character ? Math.max(0, Math.min(1, character.health / 100)) : 0;
    return `
      <div class="squad-hole squad-stat-health"><div class="squad-stat-fill" style="width:${character ? ratio * 100 : 0}%"></div></div>
      <div class="squad-hole squad-stat-str">${character ? character.strength : ''}</div>
      <div class="squad-hole squad-stat-end">${character ? character.endurance : ''}</div>
      <div class="squad-hole squad-stat-agi">${character ? character.agility : ''}</div>
      <div class="squad-hole squad-stat-int">${character ? character.intelligence : ''}</div>
    `;
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

  /** Vehicle equivalent of _fullBodyHtml. */
  _vehicleArtHtml(item) {
    if (!item) return '';
    return item.icon
      ? `<img class="squad-pose-img" src="${item.icon}" alt="">`
      : '<span class="squad-pose-emoji">🚙</span>';
  }

  _iconHtml(item, fallbackEmoji) {
    if (item?.icon) return `<img src="${item.icon}" alt="">`;
    if (item) return `<span class="squad-icon-emoji">${fallbackEmoji}</span>`;
    return '';
  }

  _slotHtml(character, itemsById, isLead, index) {
    const vehicleItem = itemsById?.get(character.vehicle);
    return `
      <button class="squad-slot squad-slot-${index} ${isLead ? 'active' : ''}" data-id="${character.id}">
        <div class="squad-slot-avatar">${this._avatarHtml(character)}</div>
        <div class="squad-slot-vehicle">${this._iconHtml(vehicleItem, '🚙')}</div>
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
