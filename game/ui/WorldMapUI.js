// WorldMapUI.js
// Placeholder full-screen panel for the future global map.

export class WorldMapUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'worldmap-modal hidden';
    this.panel.innerHTML = `
      <div class="modal-box">
        <button class="close-btn">✕</button>
        <h3>Пустошь</h3>
        <p>Глобальная карта пока недоступна — сначала откройте выход на поверхность.</p>
      </div>
    `;
    this.root.appendChild(this.panel);
    this.panel.querySelector('.close-btn').addEventListener('click', () => this.hide());
  }

  show() {
    this.panel.classList.remove('hidden');
  }

  hide() {
    this.panel.classList.add('hidden');
  }
}
