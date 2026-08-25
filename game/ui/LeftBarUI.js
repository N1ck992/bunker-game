// LeftBarUI.js
// Left end of the pipe-and-panel HUD bar below the scene (see .hud-left in
// style.css and where Game._buildDom mounts this into .bottom-bar, right
// before .hud-pipe and CharacterRosterUI's avatar row). The double-panel
// art (game/assets/ui/hud_bar_left.png) already has the icon + label baked
// into each square, in this exact order — Инвентарь first/left, Карта
// second — so the two buttons here are just invisible hit targets sized to
// match those squares, not styled boxes of their own. Карта toggles the
// world-map screen; Инвентарь opens the party's shared gear stash (see
// Game._openPartyInventory).

export class LeftBarUI {
  /** @param {{onMap:Function, onInventory:Function}} callbacks */
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this._build();
  }

  _build() {
    this.wrap = document.createElement('div');
    this.wrap.className = 'hud-left';
    this.wrap.innerHTML = `
      <button class="hud-btn hud-btn-inventory" data-action="inventory" aria-label="Инвентарь"></button>
      <button class="hud-btn hud-btn-map" data-action="map" aria-label="Карта"></button>
    `;
    this.wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'map') this.callbacks.onMap?.();
      if (action === 'inventory') this.callbacks.onInventory?.();
    });
    this.root.appendChild(this.wrap);
  }

  /** Highlights the Карта button while the world-map screen is open — the
   * art's own label stays "Карта" either way (no baked "Бункер" state to
   * swap to), so an active glow is the toggle's only visual cue now. */
  setMapMode(isOnMap) {
    const btn = this.wrap.querySelector('.hud-btn-map');
    btn.classList.toggle('active', isOnMap);
    btn.setAttribute('aria-label', isOnMap ? 'Бункер' : 'Карта');
  }
}
