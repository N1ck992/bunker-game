// CharacterRosterUI.js
// Floating column of character avatars pinned to the bottom-right corner of
// the game area (see the .roster-bar CSS and where Game._buildDom mounts
// this on #app). Always on screen, including over the world map, so the
// player can select/inspect a settler no matter which screen is active.
// Lets the player select a settler by tapping their portrait instead of
// hunting for the tiny sprite on the canvas — same selection callback the
// canvas tap uses.

const WARN_THRESHOLD = 30; // rough "needs attention" line, separate from the
                             // exact criticalThreshold in balance.json — this
                             // is just a visual cue, not a gameplay value.

export class CharacterRosterUI {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks; // { onSelect(characterId, clickEvent) }
    this._build();
  }

  _build() {
    this.bar = document.createElement('div');
    this.bar.className = 'roster-bar';
    this.bar.addEventListener('click', (e) => {
      const card = e.target.closest('.roster-avatar');
      if (!card) return;
      this.callbacks.onSelect?.(card.dataset.id, e);
    });
    this.root.appendChild(this.bar);
  }

  /** Cheap enough to call every frame — just a handful of DOM nodes. */
  update(characters, selectedId) {    // Rebuild only if the roster size changed (new characters appear
    // occasionally); otherwise just patch the existing cards in place.
    if (this.bar.children.length !== characters.length) {
      this.bar.innerHTML = '';
      for (const character of characters) {
        this.bar.appendChild(this._makeCard(character));
      }
    }

    for (const character of characters) {
      const card = this.bar.querySelector(`[data-id="${character.id}"]`);
      if (!card) continue;
      this._updateCard(card, character, character.id === selectedId);
    }
  }

  /** Unused now that the roster stays visible on every screen (see
   * Game._toggleWorldMap) — kept in case a future screen needs to hide it. */
  setVisible(visible) {
    this.bar.classList.toggle('hidden', !visible);
  }

  _makeCard(character) {
    const card = document.createElement('div');
    card.className = 'roster-avatar';
    card.dataset.id = character.id;
    card.innerHTML = `
      <div class="roster-avatar-portrait">
        <span class="roster-avatar-fallback">${character.name.charAt(0).toUpperCase()}</span>
      </div>
      <div class="roster-avatar-name"></div>
    `;
    if (character.avatar) {
      const img = document.createElement('img');
      img.src = character.avatar;
      img.alt = character.name;
      // If the art fails to load, keep the initials fallback visible instead.
      img.addEventListener('error', () => img.remove());
      card.querySelector('.roster-avatar-portrait').prepend(img);
    }
    return card;
  }

  _updateCard(card, character, isSelected) {
    card.classList.toggle('selected', isSelected);
    card.classList.toggle('inactive', !character.isActive);

    const warning =
      character.isActive &&
      (character.hunger <= WARN_THRESHOLD || character.thirst <= WARN_THRESHOLD);
    card.classList.toggle('warning', warning);

    card.querySelector('.roster-avatar-name').textContent = character.name;
  }
}
