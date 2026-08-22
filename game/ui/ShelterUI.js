// ShelterUI.js
// Renders the top resource bar and bottom nav buttons. Pure DOM, no game logic.

export class ShelterUI {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks; // { onConstruction, onCharacters, onExpedition, onMap }
    this._build();
  }

  _build() {
    this.resourceBar = document.createElement('div');
    this.resourceBar.className = 'resource-bar';
    this.resourceBar.innerHTML = `
      <div class="resource" data-res="water"><span class="icon">💧</span><span class="val">0</span></div>
      <div class="resource" data-res="food"><span class="icon">🍖</span><span class="val">0</span></div>
      <div class="resource" data-res="heat"><span class="icon">🔥</span><span class="val">0</span></div>
      <div class="resource" data-res="materials"><span class="icon">🔩</span><span class="val">0</span></div>
      <div class="clock"><span class="phase-icon">☀</span><span class="phase-label">День</span></div>
    `;

    this.navBar = document.createElement('div');
    this.navBar.className = 'nav-bar';
    this.navBar.innerHTML = `
      <button data-action="construction">Строительство</button>
      <button data-action="characters">Жители</button>
      <button data-action="expedition">Экспедиция</button>
      <button data-action="map">Карта</button>
    `;
    this.navBar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'construction') this.callbacks.onConstruction?.();
      if (action === 'characters') this.callbacks.onCharacters?.();
      if (action === 'expedition') this.callbacks.onExpedition?.();
      if (action === 'map') this.callbacks.onMap?.();
    });

    this.root.appendChild(this.resourceBar);
    this.root.appendChild(this.navBar);
  }

  update(resources, gameTime) {
    this.resourceBar.querySelector('[data-res="water"] .val').textContent = Math.floor(resources.water);
    this.resourceBar.querySelector('[data-res="food"] .val').textContent = Math.floor(resources.food);
    this.resourceBar.querySelector('[data-res="heat"] .val').textContent = Math.floor(resources.heat);
    this.resourceBar.querySelector('[data-res="materials"] .val').textContent = Math.floor(resources.materials);

    const phaseIcon = this.resourceBar.querySelector('.phase-icon');
    const phaseLabel = this.resourceBar.querySelector('.phase-label');
    phaseIcon.textContent = gameTime.isDay ? '☀' : '☾';
    phaseLabel.textContent = gameTime.isDay ? 'День' : 'Ночь';
  }

  flashLowResource(resKey) {
    const el = this.resourceBar.querySelector(`[data-res="${resKey}"]`);
    if (!el) return;
    el.classList.add('low');
    setTimeout(() => el.classList.remove('low'), 600);
  }
}
