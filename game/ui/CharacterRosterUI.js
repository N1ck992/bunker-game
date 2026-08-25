// CharacterRosterUI.js
// Widget mounted into the bottom bar below the scene (see .bottom-bar,
// .roster-wrap in style.css, and where Game._buildDom mounts this) — lives
// in normal document flow below the canvas, so it never covers the room
// the characters walk around in. Forms the right end of the pipe-and-panel
// HUD bar together with LeftBarUI's .hud-left and the .hud-pipe connector
// between them (see Game._buildDom).
//
// Shows one avatar per in-party settler, anchored to the bottom-right
// corner and growing right-to-left as more join (see .roster-avatars in
// style.css) — no separate single "current character" panel any more,
// each avatar carries its own health as a strip along its bottom edge
// (green/yellow/red — see _updatePartyAvatars). Tapping an avatar re-fires
// the same select/open callback a canvas tap on that character would.
//
// Always on screen, including over the world map.

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
    // i.e. the very bottom/corner. That has to be the avatar row;
    // anything appended after it stacks progressively higher, not lower.
    this.avatarsRow = document.createElement('div');
    this.avatarsRow.className = 'roster-avatars';
    this.wrap.appendChild(this.avatarsRow);

    // Appended second so it renders directly above the avatar row —
    // "сверху над ним" (above it).
    this.controls = document.createElement('div');
    this.controls.className = 'roster-controls';

    this.selectAllBtn = document.createElement('button');
    this.selectAllBtn.className = 'select-all-btn hidden';
    this.selectAllBtn.setAttribute('aria-label', 'Выбрать всех');
    this.selectAllBtn.addEventListener('click', () => this.callbacks.onToggleFollowAll?.());
    this.controls.appendChild(this.selectAllBtn);

    this.partyBtn = document.createElement('button');
    this.partyBtn.className = 'party-btn hidden';
    this.partyBtn.setAttribute('aria-label', 'Отряд');
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
    this.partyBtn.classList.remove('hidden');
    this.selectAllBtn.classList.remove('hidden');
    this.selectAllBtn.classList.toggle('active', !!followAllActive);

    // "Current" character (selected, else the tank, else just the first
    // one) only matters now for which avatar gets the .active highlight —
    // there's no separate single-portrait panel to fall back to any more.
    const displayChar =
      characters.find((c) => c.id === selectedId) ??
      characters.find((c) => c.isTank) ??
      characters[0] ??
      null;
    this._displayedId = displayChar?.id ?? null;

    this._updatePartyAvatars(characters, this._displayedId);
  }

  /**
   * One avatar per in-party settler (inParty !== false), in roster order —
   * see .roster-avatars (row-reverse: the first one here ends up right in
   * the corner, each next one further left). Health is drawn as a strip
   * along the bottom of the avatar instead of a separate number/bar.
   * Rebuilt each call rather than diffed: the squad is at most a handful
   * of settlers (see PartyUI.SLOT_LIMIT), so this is cheap.
   */
  _updatePartyAvatars(characters, currentId) {
    const squad = characters.filter((c) => c.inParty !== false);
    this.avatarsRow.innerHTML = squad
      .map((c) => {
        const img = c.avatar
          ? `<img src="${c.avatar}" alt="">`
          : `<span class="roster-avatar-fallback">${c.name.charAt(0).toUpperCase()}</span>`;
        const classes = [
          'roster-avatar',
          c.id === currentId ? 'active' : '',
          !c.isActive ? 'inactive' : '',
          c.inParty === false ? 'not-in-party' : ''
        ].filter(Boolean).join(' ');
        const ratio = Math.max(0, Math.min(1, c.health / 100));
        const color = c.health <= WARN_THRESHOLD ? 'var(--rust)' : ratio <= 0.6 ? '#d4a83a' : 'var(--ok)';
        return `
          <button class="${classes}" data-id="${c.id}" aria-label="${c.name}">
            ${img}
            <div class="roster-avatar-hp"><div class="roster-avatar-hp-fill" style="width:${ratio * 100}%;background:${color}"></div></div>
          </button>
        `;
      })
      .join('');

    this.avatarsRow.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => this.callbacks.onSelect?.(btn.dataset.id, e));
    });
  }

  /** Unused now that the roster stays visible on every screen (see
   * Game._toggleWorldMap). Kept in case a future screen needs to hide it. */
  setVisible(visible) {
    this.wrap.classList.toggle('hidden', !visible);
  }
}
