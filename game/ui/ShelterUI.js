// ShelterUI.js
// Renders the top resource bar (HUD strip above the scene). Pure DOM, no
// game logic. Used to also render a bottom nav bar with Жители/Экспедиция
// buttons — both were removed (Экспедиция was an unreachable stub; Жители
// was just a hint toast), along with the ExpeditionSystem/Expedition stub
// files that backed the former. The bottom-of-screen slot they used to
// occupy is now free — Выбрать всех / Отряд live in CharacterRosterUI's
// floating corner widget instead — see Game._buildDom.

export class ShelterUI {
  // topRoot hosts the resource bar, rendered above the scene as a HUD strip.
  constructor(topRoot) {
    this.topRoot = topRoot;
    this._build();
  }

  _build() {
    this.resourceBar = document.createElement('div');
    this.resourceBar.className = 'resource-bar';
    this.resourceBar.innerHTML = `
      <div class="resource" data-res="provisions"><span class="icon">🥫</span><span class="val">0</span></div>
      <div class="resource" data-res="heat"><span class="icon">🔥</span><span class="val">0</span></div>
      <div class="resource" data-res="materials"><span class="icon">🔩</span><span class="val">0</span></div>
    `;

    this.topRoot.appendChild(this.resourceBar);
  }

  /**
   * @param {object} resources - ResourceSystem instance/snapshot
   * @param {GameTime} [gameTime] - unused for now; day/night display is
   *   removed from the HUD while the cycle itself is disabled (see
   *   Game._update's commented gameTime.update()). Kept as a parameter so
   *   Game._update's call site doesn't need touching if the cycle comes
   *   back and this method starts reading it again.
   */
  update(resources, gameTime) {
    this.resourceBar.querySelector('[data-res="provisions"] .val').textContent = Math.floor(resources.provisions);
    this.resourceBar.querySelector('[data-res="heat"] .val').textContent = Math.floor(resources.heat);
    this.resourceBar.querySelector('[data-res="materials"] .val').textContent = Math.floor(resources.materials);
  }

  flashLowResource(resKey) {
    const el = this.resourceBar.querySelector(`[data-res="${resKey}"]`);
    if (!el) return;
    el.classList.add('low');
    setTimeout(() => el.classList.remove('low'), 600);
  }
}
