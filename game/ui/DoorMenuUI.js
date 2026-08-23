// DoorMenuUI.js
// Small floating context menu shown when the player taps a locked door
// whose unlockCondition is "hack:<seconds>" (see ConstructionSystem /
// Game._isHackDoor).
// Mirrors EnemyMenuUI.js: one choice, "Изучить", which starts the walk-over
// + hacking sequence (see Game._commandHackDoor / _startHacking) rather
// than acting on the door instantly.

export class DoorMenuUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'door-menu hidden';
    this.root.appendChild(this.panel);
  }

  /**
   * @param {object} interactable - the door entry from the map JSON
   * @param {number} screenX - clientX of the tap that opened the menu
   * @param {number} screenY - clientY of the tap that opened the menu
   * @param {{onExamine:Function}} handlers
   */
  show(interactable, screenX, screenY, { onExamine }) {
    this.panel.innerHTML = `
      <div class="door-menu-title">${interactable.label}</div>
      <button class="door-menu-btn examine-btn">Изучить</button>
    `;

    this.panel.querySelector('.examine-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      onExamine?.();
    });

    this.panel.classList.remove('hidden');

    // Same clamp-after-measuring approach as EnemyMenuUI, for the same reason
    // (offsetWidth is 0 while .hidden, and the menu must never spill outside
    // the app's own box on a narrow phone screen).
    const parentRect = this.root.getBoundingClientRect();
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;
    let left = screenX - parentRect.left - w / 2;
    let top = screenY - parentRect.top - h - 14;
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
