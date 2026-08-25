// StartMenu.js
// Minimal pre-game screen for testing. "Новая игра" clears any existing save
// before boot (fresh characters, full needs); "Продолжить" boots straight
// into Game.init(), which already loads the save itself — this module only
// decides *whether* to clear the save first, it doesn't touch game logic.

import { SaveSystem } from '../core/SaveSystem.js?v=27';
import { requestLandscapeLock } from '../core/OrientationLock.js?v=27';

export function showStartMenu(onStart) {
  const app = document.getElementById('app');

  // Set by Game._checkPartyWipe after a full party wipe — clears the save
  // and reloads with this flag so the player lands straight back in the
  // cryo room instead of having to tap "Новая игра" themselves after
  // already having just read a "you died" toast.
  if (new URLSearchParams(window.location.search).get('restart') === '1') {
    window.history.replaceState(null, '', window.location.pathname);
    requestLandscapeLock();
    new SaveSystem().clear();
    onStart();
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'start-menu';
  menu.innerHTML = `
    <h1>BUNKER</h1>
    <div class="start-menu-sub">прототип — тестовая сборка</div>
    <button id="btn-new-game" type="button">Новая игра</button>
    <button id="btn-continue" type="button">Продолжить</button>
  `;
  app.appendChild(menu);

  const hasSave = new SaveSystem().hasSave();
  const btnContinue = menu.querySelector('#btn-continue');
  if (!hasSave) {
    btnContinue.disabled = true;
    btnContinue.classList.add('disabled');
  }

  menu.querySelector('#btn-new-game').addEventListener('click', () => {
    // Fires from a genuine tap, so this is the one reliable place to ask
    // the browser for fullscreen + a landscape lock — see OrientationLock.js.
    requestLandscapeLock();
    new SaveSystem().clear();
    menu.remove();
    onStart();
  });

  btnContinue.addEventListener('click', () => {
    if (!hasSave) return;
    requestLandscapeLock();
    menu.remove();
    onStart();
  });
}
