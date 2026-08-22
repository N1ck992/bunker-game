// CharacterMenuUI.js
// Small floating context menu shown when the player taps a character that is
// already selected — mirrors EnemyMenuUI's pattern. The first tap on a
// character just selects them (so the player can then tap the floor to move
// them); this menu only appears on the second tap, and offers the two things
// that used to open the big stats panel immediately: Характеристики (stats)
// and Амуниция (gear/inventory).

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
   * @param {{onStats:Function, onGear:Function}} handlers
   */
  show(character, screenX, screenY, { onStats, onGear }) {
    this.panel.innerHTML = `
      <div class="character-menu-title">${character.name}</div>
      <button class="character-menu-btn stats-btn">Характеристики</button>
      <button class="character-menu-btn gear-btn">Амуниция</button>
    `;

    this.panel.querySelector('.stats-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      onStats?.();
    });
    this.panel.querySelector('.gear-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      onGear?.();
    });

    this.panel.classList.remove('hidden');

    // Measure/clamp after it's visible (offsetWidth is 0 while .hidden), so
    // the menu never spills outside the app's own box.
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
