// CharacterMenuUI.js
// Small floating context menu shown when the player taps a character that is
// already selected — mirrors EnemyMenuUI's pattern, including being mounted
// directly on #app (not uiRoot) so its getBoundingClientRect() math lines up
// with its own containing block. The first tap on a character just selects
// them (so the player can then tap the floor to move them); this menu only
// appears on the second tap.
//
// Two actions, both about squad formation (see SquadCombatSystem):
//   Щит    — makes this settler the tank (Character.isTank), the one who
//            leads and draws aggro. See Game._setTank.
//   Очередь — opens a small number picker (1-5) for this settler's place in
//            the firing line behind the tank (Character.queueOrder — lower
//            stands closer). See Game._setQueueOrder.
// Room-assignment and the inventory shortcut used to live in this menu;
// both were removed from here — inventory is still reachable from the
// bottom-left bar's "Инвентарь" button (see LeftBarUI).

const QUEUE_OPTIONS = [1, 2, 3, 4, 5];

export class CharacterMenuUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'character-menu hidden';
    this.root.appendChild(this.panel);
  }

  /**
   * @param {Character} character
   * @param {number} screenX - clientX of the tap that opened the menu
   * @param {number} screenY - clientY of the tap that opened the menu
   * @param {{onShield:Function, onQueue:(order:number)=>void}} handlers
   */
  show(character, screenX, screenY, { onShield, onQueue }) {
    this._character = character;
    this._handlers = { onShield, onQueue };
    this._screenX = screenX;
    this._screenY = screenY;

    this._renderMain();
    this.panel.classList.remove('hidden');
    this._reposition();
  }

  _renderMain() {
    const character = this._character;
    this.panel.innerHTML = `
      <div class="character-menu-title">${character.name}</div>
      <button class="character-menu-btn shield-btn">${
        character.isTank ? '🛡 Танк (уже назначен)' : '🛡 Сделать танком'
      }</button>
      <button class="character-menu-btn queue-btn">📋 Очередь: ${character.queueOrder ?? '—'}</button>
    `;

    this.panel.querySelector('.shield-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      this._handlers.onShield?.();
    });
    this.panel.querySelector('.queue-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._renderQueuePicker();
      this._reposition();
    });
  }

  _renderQueuePicker() {
    const character = this._character;
    this.panel.innerHTML = `
      <div class="character-menu-title">Очередь: ${character.name}</div>
      <div class="character-menu-queue-row">
        ${QUEUE_OPTIONS.map(
          (n) => `<button class="character-menu-queue-btn ${character.queueOrder === n ? 'active' : ''}" data-n="${n}">${n}</button>`
        ).join('')}
      </div>
      <button class="character-menu-btn back-btn">‹ Назад</button>
    `;

    this.panel.querySelectorAll('.character-menu-queue-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
        this._handlers.onQueue?.(Number(btn.dataset.n));
      });
    });
    this.panel.querySelector('.back-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._renderMain();
      this._reposition();
    });
  }

  // Measure/clamp after content is visible (offsetWidth is 0 while
  // .hidden), so the menu never spills outside the app's own box. Re-run
  // any time the panel's content (and therefore size) changes — main menu
  // vs. queue picker are different sizes.
  _reposition() {
    const parentRect = this.root.getBoundingClientRect();
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;
    let left = this._screenX - parentRect.left - w / 2;
    let top = this._screenY - parentRect.top - h - 14; // float just above the tap point
    left = Math.max(6, Math.min(left, parentRect.width - w - 6));
    top = Math.max(6, top);
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  }

  hide() {
    this.panel.classList.add('hidden');
  }

  get isVisible() {
    return !this.panel.classList.contains('hidden');
  }
}
