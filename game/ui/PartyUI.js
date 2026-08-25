// PartyUI.js
// Full-screen "Отряд" screen opened from CharacterRosterUI's party button.
//
// Two-level selection:
//  1. Bottom row (one slot per squad member, up to SLOT_LIMIT) — tapping a
//     slot makes that settler the squad's lead/tank (Character.isTank, via
//     the onSelectLead callback — same as before) and resets the left
//     column back to "hero" view for them.
//  2. Left column, for whichever settler is currently lead — two
//     selectable cards (their portrait, their vehicle) plus a static
//     gadget icon. Tapping the portrait or vehicle card switches what the
//     centre scene and the right-hand stats panel show: the hero
//     themselves (full body + health/attributes, as before) or their
//     vehicle (icon + its own stats — see _itemStatsHtml). Purely a
//     viewing toggle — it never changes the lead/tank.
//
// this._viewMode ('hero' | 'vehicle') and this._lastLeadId are the only
// state kept between show() calls, so the left-column toggle can re-render
// without a round trip through Game.js — see the toggle buttons' handlers.

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
    // Cached so the left-column view-mode toggle (hero/vehicle) can
    // re-render on its own, without Game.js re-calling show().
    this._characters = characters;
    this._itemsById = itemsById;
    this._onSelectLead = onSelectLead;
    this._onClose = onClose;

    const squad = characters.slice(0, SLOT_LIMIT);
    const lead = squad.find((c) => c.isTank) ?? squad[0] ?? null;

    // A different lead than last render (bottom slot just tapped, or the
    // screen just opened) resets the view back to "hero" — the vehicle
    // toggle is per-viewing-session, not something that should carry over
    // from whoever was inspected before.
    if (lead?.id !== this._lastLeadId) this._viewMode = 'hero';
    this._lastLeadId = lead?.id ?? null;

    const vehicleItem = lead ? itemsById?.get(lead.vehicle) : null;
    const gadgetItem = lead ? itemsById?.get(lead.gadget) : null;
    const viewedItem = this._viewMode === 'vehicle' ? vehicleItem : null;

    this.panel.innerHTML = `
      <div class="squad-frame squad-cut-corners">
        <div class="squad-topbar">
          <button class="squad-back-btn squad-cut-corners" aria-label="Назад">&lsaquo;</button>
        </div>

        <div class="squad-main">
          <div class="squad-left-col">
            <button class="squad-card squad-select-card squad-cut-corners ${this._viewMode === 'hero' ? 'active' : ''}" data-view="hero" ${lead ? '' : 'disabled'}>
              ${this._avatarHtml(lead)}
            </button>
            <button class="squad-card squad-select-card squad-cut-corners ${this._viewMode === 'vehicle' ? 'active' : ''}" data-view="vehicle" ${lead ? '' : 'disabled'}>
              ${this._iconHtml(vehicleItem, '🚙')}
            </button>
            <div class="squad-card squad-select-card squad-static-card squad-cut-corners">
              ${this._iconHtml(gadgetItem, '🔦')}
            </div>
          </div>

          <div class="squad-scene squad-cut-corners">
            <div class="squad-portrait-block">
              <div class="squad-portrait-frame squad-cut-corners">
                ${this._viewMode === 'hero' ? this._fullBodyHtml(lead) : this._vehicleArtHtml(vehicleItem)}
              </div>
            </div>
            ${this._viewMode === 'hero' ? this._statsHtml(lead) : this._itemStatsHtml(viewedItem, 'техника не выбрана')}
          </div>
        </div>

        <div class="squad-bottom-row">
          ${squad.map((c) => this._slotHtml(c, itemsById, c.id === lead?.id)).join('')}
          <button class="squad-slot squad-add-slot squad-cut-corners" aria-label="Создать отряд">
            <span class="squad-add-icon">👥﹢</span>
          </button>
        </div>
      </div>
    `;

    this.panel.querySelector('.squad-back-btn').addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    this.panel.querySelectorAll('.squad-slot[data-id]').forEach((el) => {
      el.addEventListener('click', () => onSelectLead?.(el.dataset.id));
    });

    this.panel.querySelectorAll('.squad-select-card[data-view]').forEach((el) => {
      el.addEventListener('click', () => {
        this._viewMode = el.dataset.view;
        this.show(this._characters, this._itemsById, this._onSelectLead, this._onClose);
      });
    });

    this.panel.classList.remove('hidden');
  }

  /**
   * Full characteristic readout (health + attributes) for whichever squad
   * member is currently the lead — shown when the left column's "hero"
   * card is selected. See _itemStatsHtml for the vehicle-view equivalent.
   */
  _statsHtml(character) {
    if (!character) {
      return `<div class="squad-stats-panel squad-stats-empty">— выберите героя —</div>`;
    }
    return `
      <div class="squad-stats-panel">
        <div class="squad-stat-row">
          <span>Здоровье</span>
          <div class="squad-stat-bar"><div class="squad-stat-fill health" style="width:${character.health}%"></div></div>
        </div>
        <div class="squad-attrs">
          <span>СИЛ ${character.strength}</span>
          <span>ВЫН ${character.endurance}</span>
          <span>ЛОВ ${character.agility}</span>
          <span>ИНТ ${character.intelligence}</span>
        </div>
      </div>
    `;
  }

  /**
   * Same right-hand panel, for whichever item is currently viewed instead
   * of a hero (see _viewMode) — its resistances/health modifier, plus
   * flavor text if items.json gives it one (see Item.description).
   */
  _itemStatsHtml(item, emptyLabel) {
    if (!item) {
      return `<div class="squad-stats-panel squad-stats-empty">— ${emptyLabel} —</div>`;
    }
    return `
      <div class="squad-stats-panel">
        <div class="squad-stat-row"><span>${item.name}</span></div>
        <div class="squad-attrs">
          <span>ХОЛОД ${item.coldResist >= 0 ? '+' : ''}${item.coldResist}</span>
          <span>ЖАРА ${item.heatResist >= 0 ? '+' : ''}${item.heatResist}</span>
          <span>ХП ${item.healthModifier >= 0 ? '+' : ''}${item.healthModifier}</span>
        </div>
        ${item.description ? `<div class="squad-item-desc">${item.description}</div>` : ''}
      </div>
    `;
  }

  _avatarHtml(character) {
    if (!character) return '<div class="squad-avatar-fallback">—</div>';
    return character.avatar
      ? `<img src="${character.avatar}" alt="">`
      : `<div class="squad-avatar-fallback">${character.name.charAt(0).toUpperCase()}</div>`;
  }

  /**
   * Full-body render for the squad screen's centre frame — the character's
   * own idle sprite (see Character.fullBodyArt) if it has one, else the old
   * generic silhouette/empty-slot icon.
   */
  _fullBodyHtml(character) {
    if (!character) return '<span class="squad-portrait-placeholder-icon squad-portrait-placeholder-empty">—</span>';
    return character.fullBodyArt
      ? `<img class="squad-portrait-img" src="${character.fullBodyArt}" alt="">`
      : '<span class="squad-portrait-placeholder-icon">🧍</span>';
  }

  /** Vehicle equivalent of _fullBodyHtml — a big icon (real art if items.json ever gives the item one, an emoji until then), centred the same way. */
  _vehicleArtHtml(item) {
    if (!item) return '<span class="squad-portrait-placeholder-icon squad-portrait-placeholder-empty">—</span>';
    return item.icon
      ? `<img class="squad-portrait-img" src="${item.icon}" alt="">`
      : '<span class="squad-portrait-placeholder-icon">🚙</span>';
  }

  _iconHtml(item, fallbackEmoji) {
    if (item?.icon) return `<img src="${item.icon}" alt="">`;
    if (item) return `<span class="squad-icon-emoji">${fallbackEmoji}</span>`;
    return `<span class="squad-icon-emoji squad-icon-empty">${fallbackEmoji}</span>`;
  }

  _slotHtml(character, itemsById, isLead) {
    const vehicleItem = itemsById?.get(character.vehicle);
    return `
      <button class="squad-slot squad-cut-corners ${isLead ? 'active' : ''}" data-id="${character.id}">
        <div class="squad-slot-top">${this._avatarHtml(character)}</div>
        <div class="squad-diag-divider">
          <span class="squad-dot squad-dot-left"></span>
          <span class="squad-dot squad-dot-right"></span>
        </div>
        <div class="squad-slot-bottom">${this._iconHtml(vehicleItem, '🚙')}</div>
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
