// CharacterRosterUI.js
// Widget mounted into the bottom bar below the scene (see .bottom-bar,
// .roster-wrap and .hud-right in style.css, and where Game._buildDom mounts
// this) — no longer floats over the canvas, so it never covers the room the
// characters walk around in. .roster-wrap is column-reverse, so DOM order
// controls stacking bottom-up: .hud-right (the portrait readout) is
// appended first (see _build) and sits right in the corner, forming the
// right end of the pipe-and-panel HUD bar together with LeftBarUI's
// .hud-left and the .hud-pipe connector between them (see Game._buildDom);
// the Отряд / Выбрать всех buttons are appended after it and render
// directly above.
//
// Unlike the old multi-avatar roster, .hud-right shows only ONE character —
// whichever _displayCharacter resolves as "current" (selected, else the
// tank, else the first active settler) — because the reference art
// (game/assets/ui/hud_bar_right_frame.png) frames a single portrait, not a
// row of them. The rest of the squad stays reachable via Отряд (PartyUI),
// same as before.
//
// Always on screen, including over the world map, so the player always has
// a portrait to glance at. Tapping it re-fires the same select/open callback
// a canvas tap on that character would.

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
    this._displayedId = undefined;
    this._build();
  }

  _build() {
    this.wrap = document.createElement('div');
    this.wrap.className = 'roster-wrap';

    // Appended first — with .roster-wrap's column-reverse, the first DOM
    // child is the one pinned to the main-start of the (reversed) axis,
    // i.e. the very bottom/corner. That has to be the portrait panel;
    // anything appended after it stacks progressively higher, not lower.
    this.panel = document.createElement('div');
    this.panel.className = 'hud-right';
    this.panel.innerHTML = `
      <div class="hud-portrait-slot">
        <span class="hud-portrait-fallback"></span>
        <div class="hud-hp-badge"></div>
        <div class="hud-hp-track"><div class="hud-hp-fill"></div></div>
      </div>
      <span class="hud-badge hud-badge-tank" title="Танк">🛡</span>
      <span class="hud-badge hud-badge-vehicle" title="Транспорт">🚙</span>
      <div class="hud-right-frame"></div>
    `;
    this.panel.addEventListener('click', (e) => {
      if (this._displayedId) this.callbacks.onSelect?.(this._displayedId, e);
    });
    this.wrap.appendChild(this.panel);

    // Appended second so it renders directly above the portrait panel —
    // "сверху над ним" (above it).
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
    // Always shown now (used to hide until a second squad member joined,
    // per "characters.length >= 2" — removed per request so Отряд/Выбрать
    // всех are reachable from the very start, e.g. to preview the empty
    // squad screen before anyone's been recruited).
    this.partyBtn.classList.remove('hidden');
    this.selectAllBtn.classList.remove('hidden');
    this.selectAllBtn.classList.toggle('active', !!followAllActive);

    // "Current" character for the single-portrait readout: whoever's
    // selected, else the tank, else just the first one — always shows
    // someone rather than going blank whenever selection is cleared (e.g.
    // Game._toggleWorldMap deselects on entering the map).
    const displayChar =
      characters.find((c) => c.id === selectedId) ??
      characters.find((c) => c.isTank) ??
      characters[0] ??
      null;

    this._displayedId = displayChar?.id ?? null;
    if (!displayChar) {
      this.panel.classList.add('hidden');
      return;
    }
    this.panel.classList.remove('hidden');
    this._updatePanel(displayChar);
  }

  _updatePanel(character) {
    this.panel.classList.toggle('inactive', !character.isActive);
    this.panel.classList.toggle('tank', !!character.isTank);
    this.panel.classList.toggle('has-vehicle', !!character.vehicle);
    this.panel.classList.toggle('not-in-party', character.inParty === false);

    const fallback = this.panel.querySelector('.hud-portrait-fallback');
    let img = this.panel.querySelector('.hud-portrait-img');
    if (character.avatar) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'hud-portrait-img';
        img.addEventListener('error', () => img.remove());
        this.panel.querySelector('.hud-portrait-slot').prepend(img);
      }
      if (img.src !== character.avatar) img.src = character.avatar;
      fallback.textContent = '';
    } else {
      img?.remove();
      fallback.textContent = character.name.charAt(0).toUpperCase();
    }

    const warning = character.isActive && character.health <= WARN_THRESHOLD;
    const hpBadge = this.panel.querySelector('.hud-hp-badge');
    const hpFill = this.panel.querySelector('.hud-hp-fill');
    hpBadge.textContent = Math.round(character.health);
    hpBadge.style.color = warning ? '#ffb3b3' : '';
    const ratio = Math.max(0, Math.min(1, character.health / 100));
    hpFill.style.width = `${ratio * 100}%`;
    hpFill.classList.toggle('critical', !character.isActive);
    hpFill.classList.toggle('warning', warning && character.isActive);
  }

  /** Unused now that the roster stays visible on every screen (see
   * Game._toggleWorldMap). Kept in case a future screen needs to hide it. */
  setVisible(visible) {
    this.wrap.classList.toggle('hidden', !visible);
  }
}
