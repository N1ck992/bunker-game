// CharacterRosterUI.js
// Widget mounted into the bottom bar below the scene (see .bottom-bar and
// .roster-wrap in style.css, and where Game._buildDom mounts this) — no
// longer floats over the canvas, so it never covers the room the characters
// walk around in. .roster-wrap is column-reverse, so DOM order controls
// stacking bottom-up:
// the avatar row is appended first (see _build) and sits right in the
// corner; the Отряд / Выбрать всех buttons are appended after it and render
// directly above — same spot they used to occupy before a previous pass
// split them out into PartyControlsUI's separate full-width bottom bar.
// That bar is gone now; this widget owns both again, so the game area
// doesn't waste a permanent strip at the bottom of the screen.
//
// The avatar row itself wraps onto extra lines (row-reverse + wrap-reverse)
// instead of scrolling horizontally — with several avatars on a narrow
// phone screen a horizontal scrollbar was easy to miss entirely; wrapping
// keeps every avatar visible with no ползунок.
//
// Always on screen, including over the world map, so the player can select/
// inspect a settler no matter which screen is active. Lets the player
// select a settler by tapping their portrait instead of hunting for the
// tiny sprite on the canvas — same selection callback the canvas tap uses.

const WARN_THRESHOLD = 30; // rough "needs attention" line — just a visual
                             // cue, not a gameplay value.

export class CharacterRosterUI {
  /**
   * @param {HTMLElement} root
   * @param {{onSelect:(characterId:string, clickEvent:MouseEvent)=>void, onOpenParty:()=>void, onToggleFollowAll:()=>void}} callbacks
   */
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this._lastTankId = undefined;
    this._build();
  }

  _build() {
    this.wrap = document.createElement('div');
    this.wrap.className = 'roster-wrap';

    this.bar = document.createElement('div');
    this.bar.className = 'roster-bar';
    this.bar.addEventListener('click', (e) => {
      const card = e.target.closest('.roster-avatar');
      if (!card) return;
      this.callbacks.onSelect?.(card.dataset.id, e);
    });
    // Appended first — with .roster-wrap's column-reverse, the first DOM
    // child is the one pinned to the main-start of the (reversed) axis,
    // i.e. the very bottom/corner. That has to be the avatar row; anything
    // appended after it stacks progressively higher, not lower.
    this.wrap.appendChild(this.bar);

    // Appended second so it renders directly above the avatar row —
    // "сверху над ними" (above them).
    this.controls = document.createElement('div');
    this.controls.className = 'roster-controls';

    this.selectAllBtn = document.createElement('button');
    this.selectAllBtn.className = 'select-all-btn hidden';
    this.selectAllBtn.innerHTML = '<span class="party-btn-icon">👥</span> Выбрать всех';
    this.selectAllBtn.addEventListener('click', () => this.callbacks.onToggleFollowAll?.());
    this.controls.appendChild(this.selectAllBtn);

    this.partyBtn = document.createElement('button');
    this.partyBtn.className = 'party-btn hidden';
    this.partyBtn.innerHTML = '<span class="party-btn-icon">🛡</span> Отряд';
    this.partyBtn.addEventListener('click', () => this.callbacks.onOpenParty?.());
    this.controls.appendChild(this.partyBtn);

    this.wrap.appendChild(this.controls);

    this.root.appendChild(this.wrap);
  }

  /**
   * Cheap enough to call every frame — just a handful of DOM nodes.
   * @param {boolean} [followAllActive] - "Выбрать всех" state (see
   *   Game.followAllParty), reflected on the button's active style.
   */
  update(characters, selectedId, followAllActive) {
    const tankId = characters.find((c) => c.isTank)?.id ?? null;

    // Only worth showing the controls once there's an actual squad to manage.
    const showButtons = characters.length >= 2;
    this.partyBtn.classList.toggle('hidden', !showButtons);
    this.selectAllBtn.classList.toggle('hidden', !showButtons);
    this.selectAllBtn.classList.toggle('active', !!followAllActive);

    // Rebuild if the roster size changed (new characters appear
    // occasionally) or the tank changed (that reorders the cards below);
    // otherwise just patch the existing cards in place.
    if (this.bar.children.length !== characters.length || tankId !== this._lastTankId) {
      this.bar.innerHTML = '';
      // Tank first: with .roster-bar's row-reverse layout the first DOM
      // child sits closest to the thumb (the right-hand corner anchor) —
      // front of the line, per the tank's whole "stands in front" role.
      const ordered = [...characters].sort((a, b) => (b.isTank ? 1 : 0) - (a.isTank ? 1 : 0));
      for (const character of ordered) {
        this.bar.appendChild(this._makeCard(character));
      }
      this._lastTankId = tankId;
    }

    for (const character of characters) {
      const card = this.bar.querySelector(`[data-id="${character.id}"]`);
      if (!card) continue;
      this._updateCard(card, character, character.id === selectedId);
    }
  }

  /** Unused now that the roster stays visible on every screen (see
   * Game._toggleWorldMap). Kept in case a future screen needs to hide it. */
  setVisible(visible) {
    this.wrap.classList.toggle('hidden', !visible);
  }

  _makeCard(character) {
    const card = document.createElement('div');
    card.className = 'roster-avatar';
    card.dataset.id = character.id;
    card.innerHTML = `
      <div class="roster-avatar-portrait">
        <span class="roster-avatar-fallback">${character.name.charAt(0).toUpperCase()}</span>
        <span class="roster-tank-badge" title="Танк">🛡</span>
        <span class="roster-vehicle-badge" title="Транспорт">🚙</span>
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
    card.classList.toggle('tank', !!character.isTank);
    card.classList.toggle('has-vehicle', !!character.vehicle);
    card.classList.toggle('not-in-party', character.inParty === false);

    const warning = character.isActive && character.health <= WARN_THRESHOLD;
    card.classList.toggle('warning', warning);

    card.querySelector('.roster-avatar-name').textContent = character.name;
  }
}
