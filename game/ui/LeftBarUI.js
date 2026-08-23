// LeftBarUI.js
// Two icon buttons living in the bottom bar below the scene (see .bottom-bar
// in style.css and where Game._buildDom mounts this into it) — no longer
// floating over the canvas, so they never cover the room. Карта toggles the
// world-map screen (moved here from ShelterUI's nav bar); Инвентарь opens
// the party's shared gear stash (see Game._openPartyInventory).

export class LeftBarUI {
  /** @param {{onMap:Function, onInventory:Function}} callbacks */
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this._build();
  }

  _build() {
    this.wrap = document.createElement('div');
    this.wrap.className = 'left-bar';
    this.wrap.innerHTML = `
      <button class="left-bar-btn map-btn" data-action="map">
        <span class="left-bar-icon">🗺</span><span class="left-bar-label">Карта</span>
      </button>
      <button class="left-bar-btn" data-action="inventory">
        <span class="left-bar-icon">🎒</span><span class="left-bar-label">Инвентарь</span>
      </button>
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

  /** Toggles the map button between "Карта" (go to the map) and "Бункер"
   * (return from it), so it doubles as the one control that opens and
   * closes the world-map screen. */
  setMapMode(isOnMap) {
    const btn = this.wrap.querySelector('.map-btn');
    btn.querySelector('.left-bar-label').textContent = isOnMap ? 'Бункер' : 'Карта';
    btn.classList.toggle('active', isOnMap);
  }
}
