// EnemyInfoUI.js
// Full-screen info modal opened by picking "Изучить" from EnemyMenuUI.
// Read-only — no unlock/attack actions live here, that's the mini menu's job.
// Same modal-box/close-btn visual language as ConstructionUI's info panel.

export class EnemyInfoUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'enemy-info-modal hidden';
    this.root.appendChild(this.panel);
  }

  show(enemy, onClose) {
    const healthPct = Math.max(0, Math.round((enemy.health / enemy.maxHealth) * 100));

    this.panel.innerHTML = `
      <div class="modal-box">
        <button class="close-btn">✕</button>
        <h3>${enemy.name}</h3>
        <div class="stat-row">
          <span>Здоровье</span>
          <div class="bar"><div class="fill health" style="width:${healthPct}%"></div></div>
        </div>
        <div class="attrs">
          <span>Урон: ${enemy.damage}</span>
          <span>Дист. атаки: ${enemy.attackDistance}</span>
          <span>Радиус агро: ${enemy.aggroRange}</span>
        </div>
      </div>
    `;

    this.panel.querySelector('.close-btn').addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    this.panel.classList.remove('hidden');
  }

  hide() {
    this.panel.classList.add('hidden');
  }
}
