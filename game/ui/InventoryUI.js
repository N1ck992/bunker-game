// InventoryUI.js
// Modal shown from the character panel's "Инвентарь" button. Two equip
// slots (Оружие / Одежда) up top, the character's unequipped items below,
// grouped by slot. Tapping an inventory item equips it (swapping out
// whatever was there); tapping "Снять" on a slot unequips it back into
// the inventory. Mirrors ConstructionUI's modal-box pattern.

export class InventoryUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'construction-modal hidden'; // reuse the same full-screen modal chrome
    this.root.appendChild(this.panel);
  }

  /**
   * @param {Character} character
   * @param {InventorySystem} inventorySystem
   * @param {(itemId:string) => void} onEquip
   * @param {(slot:'weapon'|'clothing') => void} onUnequip
   * @param {() => void} onClose
   */
  show(character, inventorySystem, onEquip, onUnequip, onClose) {
    const weaponItem = inventorySystem.getItem(character.weapon);
    const clothingItem = inventorySystem.getItem(character.clothing);
    const owned = inventorySystem.getInventoryItems(character);

    const weaponList = owned.filter((i) => i.slot === 'weapon');
    const clothingList = owned.filter((i) => i.slot === 'clothing');

    this.panel.innerHTML = `
      <div class="modal-box inventory-box">
        <button class="close-btn">✕</button>
        <h3>Инвентарь: ${character.name}</h3>

        <div class="equip-slot">
          <div class="equip-slot-label">Оружие</div>
          ${this._equippedRowHtml(weaponItem, 'weapon')}
        </div>
        <div class="equip-slot">
          <div class="equip-slot-label">Одежда</div>
          ${this._equippedRowHtml(clothingItem, 'clothing')}
        </div>

        <div class="inventory-section">
          <div class="inventory-section-label">Оружие в рюкзаке</div>
          ${weaponList.length ? weaponList.map((i) => this._inventoryRowHtml(i)).join('') : '<div class="inventory-empty">пусто</div>'}
        </div>
        <div class="inventory-section">
          <div class="inventory-section-label">Одежда в рюкзаке</div>
          ${clothingList.length ? clothingList.map((i) => this._inventoryRowHtml(i)).join('') : '<div class="inventory-empty">пусто</div>'}
        </div>
      </div>
    `;

    this.panel.querySelector('.close-btn').addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    this.panel.querySelectorAll('.unequip-btn').forEach((btn) => {
      btn.addEventListener('click', () => onUnequip?.(btn.dataset.slot));
    });

    this.panel.querySelectorAll('.equip-btn').forEach((btn) => {
      btn.addEventListener('click', () => onEquip?.(btn.dataset.itemId));
    });

    this.panel.classList.remove('hidden');
  }

  _equippedRowHtml(item, slot) {
    if (!item) return `<div class="equip-row empty">— пусто —</div>`;
    return `
      <div class="equip-row">
        ${this._itemIconHtml(item)}
        <span class="item-name">${item.name}</span>
        ${this._statsHtml(item)}
        <button class="unequip-btn" data-slot="${slot}">Снять</button>
      </div>
    `;
  }

  _inventoryRowHtml(item) {
    return `
      <div class="equip-row">
        ${this._itemIconHtml(item)}
        <span class="item-name">${item.name}</span>
        ${this._statsHtml(item)}
        <button class="equip-btn" data-item-id="${item.id}">Экипировать</button>
      </div>
    `;
  }

  // No art delivered yet for any item — plain placeholder swatch instead of
  // an <img>, same spirit as the enemy-sprite fallback in Game._renderEnemies.
  _itemIconHtml(item) {
    return `<span class="item-icon">${item.slot === 'weapon' ? '⚔' : '🧥'}</span>`;
  }

  _statsHtml(item) {
    if (item.slot === 'weapon') {
      return `<span class="item-stats">${item.damage} урона (${item.damageType ?? '?'}) · дальность ${item.range}</span>`;
    }
    const parts = [];
    if (item.coldResist) parts.push(`холод ${item.coldResist > 0 ? '+' : ''}${item.coldResist}`);
    if (item.heatResist) parts.push(`жара ${item.heatResist > 0 ? '+' : ''}${item.heatResist}`);
    if (item.healthModifier) parts.push(`здоровье ${item.healthModifier > 0 ? '+' : ''}${item.healthModifier}`);
    if (item.allowsTravel) parts.push('можно выходить на поверхность');
    return `<span class="item-stats">${parts.join(' · ')}</span>`;
  }

  hide() {
    this.panel.classList.add('hidden');
  }
}
