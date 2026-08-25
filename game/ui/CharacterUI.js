// CharacterUI.js

export class CharacterUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'character-panel hidden';
    this.root.appendChild(this.panel);
  }

  show(character, rooms, onAssign, onClose, onOpenInventory, itemsById) {
    const roomOptions = rooms
      .filter((r) => r.accessible)
      .map((r) => `<option value="${r.id}" ${character.assignedRoom === r.id ? 'selected' : ''}>${r.name}</option>`)
      .join('');

    const weaponItem = itemsById?.get(character.weapon);
    const clothingItem = itemsById?.get(character.clothing);

    this.panel.innerHTML = `
      <div class="panel-header">
        <strong>${character.name}</strong>
        <span class="state-badge ${character.state}">${character.state === 'active' ? 'активен' : 'неактивен'}</span>
        <button class="close-btn">✕</button>
      </div>
      <div class="stat-row"><span>Здоровье</span><div class="bar"><div class="fill health" style="width:${character.health}%"></div></div></div>
      <!-- Температура временно скрыта — механика отключена, см. Game._update (TEMPERATURE_ENABLED) -->
      <div class="attrs">
        <span>СИЛ ${character.strength}</span>
        <span>ВЫН ${character.endurance}</span>
        <span>ЛОВ ${character.agility}</span>
        <span>ИНТ ${character.intelligence}</span>
      </div>
      <div class="gear-row">
        <span class="gear-slot">Оружие: <strong>${weaponItem ? weaponItem.name : '— пусто —'}</strong></span>
        <span class="gear-slot">Одежда: <strong>${clothingItem ? clothingItem.name : '— пусто —'}</strong></span>
      </div>
      <button class="inventory-btn">Инвентарь</button>
      <div class="assign-row">
        <label>Назначить в комнату:</label>
        <select class="assign-select">
          <option value="">— не назначен —</option>
          ${roomOptions}
        </select>
      </div>
    `;

    this.panel.querySelector('.close-btn').addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    this.panel.querySelector('.assign-select').addEventListener('change', (e) => {
      onAssign?.(e.target.value || null);
    });

    this.panel.querySelector('.inventory-btn').addEventListener('click', () => {
      onOpenInventory?.(character);
    });

    this.panel.classList.remove('hidden');
  }

  hide() {
    this.panel.classList.add('hidden');
  }

  get isVisible() {
    return !this.panel.classList.contains('hidden');
  }
}
