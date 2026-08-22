// ConstructionUI.js
// Small modal shown when the player taps a door/ladder interactable.

export class ConstructionUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'construction-modal hidden';
    this.root.appendChild(this.panel);
  }

  showLockedInfo(interactable, linkedRoom, resources, onUnlock, onClose) {
    let bodyHtml;

    if (interactable.unlockCondition && interactable.unlockCondition.startsWith('story:')) {
      bodyHtml = `<p>Пока недоступно. Откроется позже по сюжету.</p>`;
    } else {
      const cost = linkedRoom?.unlockCost ?? {};
      const costHtml = Object.entries(cost)
        .map(([k, v]) => `<span class="cost-item ${resources[k] >= v ? 'ok' : 'bad'}">${labelFor(k)}: ${v}</span>`)
        .join(' ');
      bodyHtml = `
        <p>${interactable.label}</p>
        <p>${linkedRoom?.description ?? ''}</p>
        <div class="cost-row">${costHtml}</div>
        <button class="unlock-btn">Открыть</button>
      `;
    }

    this.panel.innerHTML = `
      <div class="modal-box">
        <button class="close-btn">✕</button>
        <h3>${interactable.label}</h3>
        ${bodyHtml}
      </div>
    `;

    this.panel.querySelector('.close-btn').addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    const unlockBtn = this.panel.querySelector('.unlock-btn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', () => onUnlock?.());
    }

    this.panel.classList.remove('hidden');
  }

  hide() {
    this.panel.classList.add('hidden');
  }
}

function labelFor(key) {
  return { water: 'Вода', food: 'Еда', heat: 'Тепло', materials: 'Материалы' }[key] ?? key;
}
