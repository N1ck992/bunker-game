// PartyUI.js
// Full-screen "Отряд" screen opened from CharacterRosterUI's party button.
// Redesigned from the old checkbox modal into a squad-loadout viewer: the
// left column shows the currently-led squad member's hero/vehicle/gadget
// (small icons), the centre scene shows a full-body placeholder portrait of
// that same lead plus a pair of cells for vehicle/device art (real art to
// be dropped in later — see squad-portrait-frame/squad-loadout-mini below),
// the right side of the scene is the one place the lead's full
// characteristic readout lives (see _statsHtml), the bottom row lets the
// player switch which recruited settler leads the squad (reuses
// Character.isTank — see Game._openPartyUI), and the trailing "+" cell is a
// placeholder for a future full roster/squad-builder screen (see
// PartyUI.SLOT_LIMIT and the onAddSquad callback, currently a no-op).

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
   * @param {(characterId:string) => void} onSelectLead - fired when a bottom slot is tapped
   * @param {() => void} onClose
   */
  show(characters, itemsById, onSelectLead, onClose) {
    const squad = characters.slice(0, SLOT_LIMIT);
    const lead = squad.find((c) => c.isTank) ?? squad[0] ?? null;

    const vehicleItem = lead ? itemsById?.get(lead.vehicle) : null;
    const gadgetItem = lead ? itemsById?.get(lead.gadget) : null;

    this.panel.innerHTML = `
      <div class="squad-frame">
        <div class="squad-topbar">
          <button class="squad-back-btn" aria-label="Назад">&lsaquo;</button>
        </div>

        <div class="squad-main">
          <div class="squad-left-col">
            <div class="squad-card squad-hero-card">
              ${this._avatarHtml(lead)}
            </div>
            <div class="squad-card squad-loadout-card">
              <div class="squad-loadout-half squad-loadout-top">
                ${this._iconHtml(vehicleItem, '🚙')}
              </div>
              <div class="squad-diag-divider">
                <span class="squad-dot squad-dot-left"></span>
                <span class="squad-dot squad-dot-right"></span>
              </div>
              <div class="squad-loadout-half squad-loadout-bottom">
                ${this._iconHtml(gadgetItem, '🔦')}
              </div>
            </div>
          </div>

          <div class="squad-scene">
            <div class="squad-portrait-block">
              <div class="squad-portrait-frame">
                ${lead ? '<span class="squad-portrait-placeholder-icon">🧍</span>' : '<span class="squad-portrait-placeholder-icon squad-portrait-placeholder-empty">—</span>'}
              </div>
              <div class="squad-loadout-mini">
                <div class="squad-loadout-mini-cell" title="Техника">${this._iconHtml(vehicleItem, '🚙')}</div>
                <div class="squad-loadout-mini-cell" title="Устройство">${this._iconHtml(gadgetItem, '🔦')}</div>
              </div>
            </div>
            ${this._statsHtml(lead)}
          </div>
        </div>

        <div class="squad-bottom-row">
          ${squad.map((c) => this._slotHtml(c, itemsById, c.id === lead?.id)).join('')}
          <button class="squad-slot squad-add-slot" aria-label="Создать отряд">
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

    // squad-add-slot deliberately has no click handler yet — see file header.

    this.panel.classList.remove('hidden');
  }

  /**
   * Full characteristic readout (health/hunger/thirst/temperature +
   * attributes) for whichever squad member is currently selected (the
   * lead — see _openPartyUI's onSelectLead). This is the one and only
   * place these stats are shown — the roster's per-character menu now only
   * offers Щит/Очередь (formation controls), not a stats view — see
   * game/ui/CharacterMenuUI.js.
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
        <div class="squad-stat-row">
          <span>Голод</span>
          <div class="squad-stat-bar"><div class="squad-stat-fill hunger" style="width:${character.hunger}%"></div></div>
        </div>
        <div class="squad-stat-row">
          <span>Жажда</span>
          <div class="squad-stat-bar"><div class="squad-stat-fill thirst" style="width:${character.thirst}%"></div></div>
        </div>
        <div class="squad-stat-row squad-stat-temp">
          <span>Температура</span>
          <span>${Math.round(character.temperature)}°</span>
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

  _avatarHtml(character) {
    if (!character) return '<div class="squad-avatar-fallback">—</div>';
    return character.avatar
      ? `<img src="${character.avatar}" alt="">`
      : `<div class="squad-avatar-fallback">${character.name.charAt(0).toUpperCase()}</div>`;
  }

  _iconHtml(item, fallbackEmoji) {
    if (item?.icon) return `<img src="${item.icon}" alt="">`;
    if (item) return `<span class="squad-icon-emoji">${fallbackEmoji}</span>`;
    return `<span class="squad-icon-emoji squad-icon-empty">${fallbackEmoji}</span>`;
  }

  _slotHtml(character, itemsById, isLead) {
    const vehicleItem = itemsById?.get(character.vehicle);
    return `
      <button class="squad-slot ${isLead ? 'active' : ''}" data-id="${character.id}">
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
