// EnemyMenuUI.js
// Small floating context menu shown when the player taps an enemy on the
// map, instead of immediately walking the selected character over there
// (that used to send the hero right onto the enemy's tile). Two choices:
// "Изучить" (inspect, no movement) and "Атаковать" (walk to weapon range
// and hold position — see Game._commandAttack).
//
// Positioned in screen space near the tap point, inside the same uiRoot as
// every other panel — it floats over the canvas rather than covering the
// whole screen like ConstructionUI's modal, so a tap elsewhere on the map
// should hide() it (see Game._onTap).

export class EnemyMenuUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'enemy-menu hidden';
    this.root.appendChild(this.panel);
  }

  /**
   * @param {Enemy} enemy
   * @param {number} screenX - clientX of the tap that opened the menu
   * @param {number} screenY - clientY of the tap that opened the menu
   * @param {{onExamine:Function, onAttack:Function}} handlers
   */
  show(enemy, screenX, screenY, { onExamine, onAttack }) {
    this.panel.innerHTML = `
      <div class="enemy-menu-title">${enemy.name}</div>
      <button class="enemy-menu-btn examine-btn">Изучить</button>
      <button class="enemy-menu-btn attack-btn">Атаковать</button>
    `;

    this.panel.querySelector('.examine-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      onExamine?.();
    });
    this.panel.querySelector('.attack-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      onAttack?.();
    });

    this.panel.classList.remove('hidden');

    // Measure/clamp after it's visible (offsetWidth is 0 while .hidden), so
    // the menu never spills outside the app's own box — important since the
    // tap can land right at the edge of the scene on a narrow phone screen.
    const parentRect = this.root.getBoundingClientRect();
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;
    let left = screenX - parentRect.left - w / 2;
    let top = screenY - parentRect.top - h - 14; // float just above the tap point
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
