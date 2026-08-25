// InventoryUI.js
// Full-screen "Хранилище" (storage) screen, redesigned to match a reference
// mockup: a left nav with two tabs, a slot grid in the middle, and a detail
// panel on the right for whichever slot is selected.
//
//   - "Предметы"          — everything that isn't hero gear or a vehicle:
//                            key items today, any future consumables/
//                            resources later. Always comes from the shared
//                            pool (Game.partyInventory) since nothing here
//                            is ever "worn".
//   - "Снаряжение героя"  — every weapon/clothing item the party owns,
//                            worn or not, so equipping/swapping gear lives
//                            in one place. Vehicles never appear in this
//                            screen at all — see Game._openPartyInventory's
//                            header comment; they'll get their own menu.
//
// Tapping a filled grid slot selects it (highlight ring) and fills the
// detail panel with its icon, name, stats, and description (only real
// data.json fields are shown — see _statRows). From there: an unequipped
// item gets an "equip on..." picker + button, an equipped one gets "Снять".
// Key items just show info. Mirrors ConstructionUI's modal-box pattern for
// the outer shell, but with its own ornate frame (see .inv-* CSS, styled to
// match game/ui/PartyUI.js's squad screen).

const GRID_SIZE = 20; // 5 columns x 4 rows, matches the reference mockup
const SLOT_ICONS = { weapon: '⚔', clothing: '🧥', vehicle: '🚙', key: '🔑' };
const DAMAGE_TYPE_LABELS = { kinetic: 'Кинетический', energy: 'Энергетический' };

export class InventoryUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'squad-screen inv-screen hidden'; // reuses the fixed-fullscreen shell
    this.root.appendChild(this.panel);

    this._tab = 'items'; // 'items' | 'gear'
    this._selectedItemId = null;

    this.panel.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('.inv-back-btn');
      if (closeBtn) {
        this.hide();
        this._onClose?.();
        return;
      }

      const navBtn = e.target.closest('.inv-nav-btn');
      if (navBtn) {
        this._tab = navBtn.dataset.tab;
        this._selectedItemId = null;
        this._render();
        return;
      }

      const slot = e.target.closest('.inv-slot[data-item-id]');
      if (slot) {
        this._selectedItemId = slot.dataset.itemId;
        this._render();
        return;
      }

      const unequipBtn = e.target.closest('.unequip-btn');
      if (unequipBtn) {
        this._onUnequip?.(unequipBtn.dataset.characterId, unequipBtn.dataset.slot);
        return;
      }

      const equipBtn = e.target.closest('.equip-btn');
      if (equipBtn) {
        const select = this.panel.querySelector('.equip-target-select');
        const characterId = select?.value;
        if (characterId) this._onEquip?.(characterId, equipBtn.dataset.itemId);
      }
    });
  }

  /**
   * @param {Character[]} characters - the recruited party
   * @param {string[]} partyInventory - shared pool of unequipped item ids
   * @param {InventorySystem} inventorySystem
   * @param {(characterId:string, itemId:string) => void} onEquip
   * @param {(characterId:string, slot:'weapon'|'clothing'|'vehicle') => void} onUnequip
   * @param {() => void} onClose
   * @param {string} [focusCharacterId] - whose gear "Снаряжение героя" shows
   */
  show(characters, partyInventory, inventorySystem, onEquip, onUnequip, onClose, focusCharacterId) {
    this._characters = characters;
    this._partyInventory = partyInventory;
    this._inventorySystem = inventorySystem;
    this._onEquip = onEquip;
    this._onUnequip = onUnequip;
    this._onClose = onClose;
    this._focusCharacterId = focusCharacterId ?? characters[0]?.id ?? null;
    this._tab = 'items';
    this._selectedItemId = null;

    this._render();
    this.panel.classList.remove('hidden');
  }

  _render() {
    const rows = this._tab === 'items' ? this._itemRows() : this._gearRows();
    const slots = [...rows];
    while (slots.length < GRID_SIZE) slots.push(null);

    this.panel.innerHTML = `
      <div class="inv-frame">
        <div class="inv-topbar">
          <button class="inv-back-btn" aria-label="Назад">&lsaquo;</button>
          <h2 class="inv-title">Хранилище</h2>
        </div>
        <div class="inv-body">
          <div class="inv-nav">
            <button class="inv-nav-btn ${this._tab === 'items' ? 'active' : ''}" data-tab="items">
              <span class="inv-nav-icon">📦</span>
              <span>Предметы</span>
            </button>
            <button class="inv-nav-btn ${this._tab === 'gear' ? 'active' : ''}" data-tab="gear">
              <span class="inv-nav-icon">🧥</span>
              <span>Снаряжение<br>героя</span>
            </button>
          </div>
          <div class="inv-grid">
            ${slots.map((row) => this._slotHtml(row)).join('')}
          </div>
          <div class="inv-detail">
            ${this._detailHtml()}
          </div>
        </div>
      </div>
    `;
  }

  // --- Grid slots ----------------------------------------------------------

  _slotHtml(row) {
    if (!row) return '<div class="inv-slot inv-slot-empty"></div>';
    const selected = row.item.id === this._selectedItemId;
    return `
      <div class="inv-slot ${selected ? 'active' : ''}" data-item-id="${row.item.id}">
        ${this._itemIconHtml(row.item)}
      </div>
    `;
  }

  // "Предметы" tab: everything that isn't hero gear or a vehicle — key
  // items, and any future consumables/resources. Weapons and clothing live
  // exclusively under "Снаряжение героя" (see _gearRows), and vehicles
  // aren't shown in the inventory at all — they'll get their own screen.
  _itemRows() {
    const pool = this._inventorySystem
      .getPartyInventoryItems(this._partyInventory)
      .filter((item) => item.slot !== 'weapon' && item.slot !== 'clothing' && item.slot !== 'vehicle')
      .map((item) => ({ item, owner: null }));
    return pool;
  }

  // "Снаряжение героя" tab: every weapon/clothing item the party owns,
  // worn or not — spare gear sitting in the shared pool (owner: null, so it
  // can be equipped onto anyone via the picker) plus whatever's currently
  // equipped on any settler (owner: that Character, with a "Снять" action).
  // Vehicles are deliberately excluded — not shown in the inventory at all.
  _gearRows() {
    const pool = this._inventorySystem
      .getPartyInventoryItems(this._partyInventory)
      .filter((item) => item.slot === 'weapon' || item.slot === 'clothing')
      .map((item) => ({ item, owner: null }));

    const equipped = [];
    for (const slot of ['weapon', 'clothing']) {
      for (const character of this._characters) {
        const item = this._inventorySystem.getItem(character[slot]);
        if (item) equipped.push({ item, owner: character });
      }
    }

    return [...pool, ...equipped];
  }

  _findRow(itemId) {
    const rows = this._tab === 'items' ? this._itemRows() : this._gearRows();
    return rows.find((r) => r.item.id === itemId);
  }

  // --- Detail panel ----------------------------------------------------------

  _detailHtml() {
    if (!this._selectedItemId) {
      return '<div class="inv-detail-empty">Выберите предмет</div>';
    }
    const found = this._findRow(this._selectedItemId);
    if (!found) {
      // Item moved out from under us (equipped/unequipped elsewhere).
      this._selectedItemId = null;
      return '<div class="inv-detail-empty">Выберите предмет</div>';
    }
    const { item, owner } = found;

    let actionHtml;
    if (item.slot === 'key') {
      actionHtml = '';
    } else if (owner) {
      actionHtml = `
        <div class="detail-owner">Экипировано: <strong>${owner.name}</strong></div>
        <button class="unequip-btn" data-character-id="${owner.id}" data-slot="${item.slot}">Снять</button>
      `;
    } else {
      const charOptionsHtml = this._characters
        .map((c) => `<option value="${c.id}"${c.id === this._focusCharacterId ? ' selected' : ''}>${c.name}</option>`)
        .join('');
      actionHtml = `
        <div class="assign-row">
          <label>Экипировать на:</label>
          <select class="assign-select equip-target-select">${charOptionsHtml}</select>
        </div>
        <button class="equip-btn" data-item-id="${item.id}">Экипировать</button>
      `;
    }

    return `
      <div class="inv-detail-icon">${this._itemIconHtml(item, true)}</div>
      <div class="inv-detail-name">${item.name}</div>
      ${item.slot === 'weapon' ? `<div class="inv-detail-subtitle">Тип урона: ${DAMAGE_TYPE_LABELS[item.damageType] ?? item.damageType ?? '—'}</div>` : ''}
      <div class="inv-stat-list">
        ${this._statRows(item).map((r) => `
          <div class="inv-stat-row">
            <span class="inv-stat-icon">${r.icon}</span>
            <span class="inv-stat-label">${r.label}</span>
            <span class="inv-stat-value">${r.value}</span>
          </div>
        `).join('')}
      </div>
      ${item.description ? `<div class="inv-detail-desc">${item.description}</div>` : ''}
      <div class="inv-detail-actions">${actionHtml}</div>
    `;
  }

  // Only ever shows fields we actually have data for (see Item.js) — no
  // placeholder/estimated stats like accuracy, magazine size, or weight.
  _statRows(item) {
    const rows = [];
    if (item.slot === 'weapon') {
      rows.push({ icon: '💥', label: 'Урон', value: item.damage });
      rows.push({ icon: '🎯', label: 'Дальность', value: item.range });
      rows.push({ icon: '⏱', label: 'Перезарядка', value: `${item.attackCooldownSeconds} с` });
      return rows;
    }
    if (item.coldResist) rows.push({ icon: '❄', label: 'Защита от холода', value: this._signed(item.coldResist) });
    if (item.heatResist) rows.push({ icon: '🔥', label: 'Защита от жары', value: this._signed(item.heatResist) });
    if (item.healthModifier) rows.push({ icon: '❤', label: 'Здоровье', value: this._signed(item.healthModifier) });
    if (item.allowsTravel) rows.push({ icon: '🧭', label: 'Выход на поверхность', value: 'Да' });
    return rows;
  }

  _signed(n) {
    return n > 0 ? `+${n}` : `${n}`;
  }

  // No art delivered yet for any item — plain emoji placeholder instead of
  // an <img>, same spirit as the enemy-sprite fallback in Game._renderEnemies.
  _itemIconHtml(item, large) {
    const cls = large ? 'inv-icon-emoji inv-icon-emoji-large' : 'inv-icon-emoji';
    if (item.icon) return `<img src="${item.icon}" alt="" class="${large ? 'inv-icon-img-large' : 'inv-icon-img'}">`;
    return `<span class="${cls}">${SLOT_ICONS[item.slot] ?? '❔'}</span>`;
  }

  hide() {
    this.panel.classList.add('hidden');
    this._selectedItemId = null;
  }

  get isVisible() {
    return !this.panel.classList.contains('hidden');
  }
}
