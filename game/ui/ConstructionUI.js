// ConstructionUI.js
// Small modal shown when the player taps a door/ladder interactable.

export class ConstructionUI {
  constructor(root) {
    this.root = root;
    this.panel = document.createElement('div');
    this.panel.className = 'construction-modal hidden';
    this.root.appendChild(this.panel);
  }

  /**
   * @param {object} interactable
   * @param {(id:string)=>Item} onUnlock
   * @param {() => void} onClose
   * @param {Map<string,Item>} itemsById
   */
  showLockedInfo(interactable, onUnlock, onClose, itemsById = new Map()) {
    let bodyHtml;

    if (interactable.unlockCondition && interactable.unlockCondition.startsWith('story:')) {
      bodyHtml = `<p>Пока недоступно. Откроется позже по сюжету.</p>`;
    } else if (interactable.unlockCondition && interactable.unlockCondition.startsWith('item:')) {
      const itemId = interactable.unlockCondition.slice('item:'.length);
      const itemName = itemsById.get(itemId)?.name ?? itemId;
      bodyHtml = `
        <p>${interactable.label}</p>
        <p>Нужен предмет: <strong>${itemName}</strong></p>
        <button class="unlock-btn">Открыть</button>
      `;
    } else {
      bodyHtml = `<p>${interactable.label}</p><p>Пока недоступно.</p>`;
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

  /**
   * "Перейти на другой этаж?" prompt shown before any door actually swaps
   * the active level (see Game._confirmLevelTransition) — both for an
   * already-open passage door someone just walks up and taps again, and
   * right after a locked one gets unlocked, so a floor change is never a
   * surprise no matter which path got the player there.
   */
  showTransitionConfirm(interactable, onConfirm, onCancel) {
    this.panel.innerHTML = `
      <div class="modal-box">
        <button class="close-btn">✕</button>
        <h3>${interactable.label}</h3>
        <p>Перейти на другой этаж?</p>
        <div class="confirm-row">
          <button class="confirm-btn">Перейти</button>
          <button class="cancel-btn">Остаться</button>
        </div>
      </div>
    `;

    const close = (cb) => {
      this.hide();
      cb?.();
    };
    this.panel.querySelector('.close-btn').addEventListener('click', () => close(onCancel));
    this.panel.querySelector('.cancel-btn').addEventListener('click', () => close(onCancel));
    this.panel.querySelector('.confirm-btn').addEventListener('click', () => close(onConfirm));

    this.panel.classList.remove('hidden');
  }

  hide() {
    this.panel.classList.add('hidden');
  }
}
