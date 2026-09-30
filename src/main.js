// Boot: loading screen, title menu, lobby, and switching between solo and co-op.
import { THREE, CANNON } from './lib.js';
import { Game } from './game.js';
import { Hud } from './ui/hud.js';
import { Audio } from './audio.js';
import { SoloSession, RoomSession, PROTOCOL } from './net/session.js';
import { checkPassword, connectMesh } from './net/mesh.js';
import { HAT_COLORS, HAT_NAMES, HATS, GLASSES, SKIN, lookOf } from './player.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('wideload.' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('wideload.' + k, JSON.stringify(v));
    } catch {
      /* storage is optional */
    }
  },
};

const profile = { name: store.get('name', 'Driver'), color: store.get('color', 0), look: lookOf(store.get('look', {})) };
let game, hud, audio, room = null, myPeer = null;
let current = null; // current co-op session info

function setupProfile() {
  const name = $('#name');
  name.value = profile.name;
  name.addEventListener('input', () => {
    // presence strings must be free of control and invisible characters
    profile.name = name.value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, 18) || 'Driver';
    store.set('name', profile.name);
  });
  const hats = $('#hats');
  HAT_COLORS.forEach((c, k) => {
    const b = document.createElement('button');
    b.className = 'hat';
    b.type = 'button';
    b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.setAttribute('aria-label', HAT_NAMES[k] + ' crew color');
    b.setAttribute('aria-pressed', String(k === profile.color));
    b.addEventListener('click', () => {
      profile.color = k;
      store.set('color', k);
      for (const x of hats.children) x.setAttribute('aria-pressed', String(x === b));
      previewLook();
    });
    hats.appendChild(b);
  });
  // hats and shades cycle on click (shift-click goes back)
  const picker = (btn, label, list, key) => {
    const show = () => ($(label).textContent = list[profile.look[key]][1]);
    show();
    $(btn).addEventListener('click', (e) => {
      const n = list.length;
      profile.look[key] = (profile.look[key] + (e.shiftKey ? n - 1 : 1)) % n;
      store.set('look', profile.look);
      show();
      previewLook();
    });
  };
  picker('#pick-hat', '#hat-label', HATS, 'hat');
  picker('#pick-glasses', '#glasses-label', GLASSES, 'glasses');
  const skin = $('#pick-skin');
  const showSkin = () => {
    skin.style.background = '#' + SKIN[profile.look.skin].toString(16).padStart(6, '0');
    skin.setAttribute('aria-label', `Skin tone ${profile.look.skin + 1} of ${SKIN.length}`);
  };
  showSkin();
  skin.addEventListener('click', (e) => {
    const n = SKIN.length;
    profile.look.skin = (profile.look.skin + (e.shiftKey ? n - 1 : 1)) % n;
    store.set('look', profile.look);
    showSkin();
    previewLook();
  });
}

/** The title screen shows your crew member by the truck: keep it in sync with the picks. */
function previewLook() {
  if (!game || game.mode !== 'intro') return;
  game.opts.color = profile.color;
  game.opts.look = { ...profile.look };
  game.player.setLook(profile.color, profile.name, profile.look);
}

async function boot() {
  setupProfile();
  // let the loading screen paint before the heavy world build
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  try {
    await Promise.race([document.fonts?.load?.('900 40px "Big Shoulders Display"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* fonts are optional */
  }
  hud = new Hud();
  audio = new Audio();
  $('#loading-msg').textContent = 'Loading Dolores…';
  await new Promise((r) => setTimeout(r, 10));
  game = new Game($('#view'), { session: new SoloSession(profile), hud, audio, name: profile.name, color: profile.color, look: { ...profile.look }, mode: 'intro' });
  hud.onEnd = showEnd;
  hud.onSay = (text) => game.sayText(text);
  hud.onChatClosed = () => {
    if (game.mode === 'play' && !game.paused) lockMouse();
  };
  game.start();
  $('#loading').hidden = true;
  $('#menu').hidden = false;
  wireButtons();
  connectLobby();
  if (window.__WL_DEBUG) window.__wl = { THREE, CANNON, game, world: game.world, hud, startSolo, profile };
}

function wireButtons() {
  $('#btn-solo').addEventListener('click', startSolo);
  $('#btn-host').addEventListener('click', hostJob);
  $('#btn-resume').addEventListener('click', () => setPaused(false));
  $('#btn-tow').addEventListener('click', () => {
    game.requestTow();
    setPaused(false);
  });
  $('#btn-restart').addEventListener('click', () => {
    game.requestRestart();
    setPaused(false);
  });
  $('#btn-mute').addEventListener('click', toggleMute);
  const applyGfx = (fast) => {
    game.setGraphics(fast);
    $('#gfx-label').textContent = fast ? 'Graphics: Fast' : 'Graphics: Fancy';
    store.set('fastGfx', fast);
  };
  $('#btn-gfx').addEventListener('click', () => applyGfx(!game.fastGfx));
  if (store.get('fastGfx', false)) applyGfx(true);
  $('#btn-quit').addEventListener('click', quitToTitle);
  $('#btn-endquit').addEventListener('click', quitToTitle);
  $('#btn-lostquit').addEventListener('click', quitToTitle);
  $('#btn-again').addEventListener('click', () => {
    $('#end').hidden = true;
    game.requestRestart();
    lockMouse();
  });
  const canvas = game.renderer.domElement;
  canvas.addEventListener('click', () => {
    if (game.mode === 'play' && !game.paused) lockMouse();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    $('#clicklook').hidden = locked || game.mode !== 'play' || game.paused;
    // the browser releases the mouse on Esc: treat that as a pause
    if (!locked && game.mode === 'play' && !game.paused && !game._suppressPause && $('#end').hidden) setPaused(true);
    game._suppressPause = false;
  });
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (hud.typing) return;
    if (e.code === 'Escape' && game.mode === 'play' && $('#end').hidden) setPaused(!game.paused);
    if (e.code === 'KeyM' && game.mode === 'play') toggleMute();
  });
  audio.muted = store.get('muted', false);
  $('#mute-label').textContent = audio.muted ? 'Turn sound on' : 'Mute sound';
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  $('#mute-label').textContent = audio.muted ? 'Turn sound on' : 'Mute sound';
  store.set('muted', audio.muted);
}

function lockMouse() {
  game.input.requestLock();
}

function setPaused(p) {
  game.paused = p;
  $('#pause').hidden = !p;
  $('#pause-note').textContent = game.session.solo ? 'The job is paused.' : 'The job keeps running for the rest of the crew.';
  $('#btn-restart').hidden = !game.session.isHost;
  if (p) {
    game._suppressPause = true;
    game.input.exitLock();
    game.hold = null;
    game.player.action = null;
  } else lockMouse();
}

function enterPlay() {
  audio.start();
  audio.setMuted(audio.muted);
  $('#menu').hidden = true;
  $('#end').hidden = true;
  $('#hostlost').hidden = true;
  hud.show(true);
  game.mode = 'play';
  game.cam.yaw = game.world.road.heading(game.startIndex) + Math.PI * 0.75;
  game.cam.targetDist = 6.5;
  $('#clicklook').hidden = false;
  lockMouse();
}

function startSolo() {
  if (!game.session.solo) game.setSession(new SoloSession(profile), profile);
  game.opts.name = profile.name;
  game.opts.color = profile.color;
  game.opts.look = { ...profile.look };
  game.player.setLook(profile.color, profile.name, profile.look);
  game.resetJob(true);
  enterPlay();
  hud.toast('Walk to the cab and press F to drive. The yellow toolbox behind the cab has your gear.');
}

function quitToTitle() {
  $('#pause').hidden = true;
  $('#end').hidden = true;
  $('#hostlost').hidden = true;
  game.paused = false;
  if (current) {
    current.session.leave();
    room?.presence({ lob: null }).catch(() => {});
    clearTimeout(advertise.t);
    current = null;
  }
  game.setSession(new SoloSession(profile), profile);
  game.mode = 'intro';
  hud.show(false);
  $('#menu').hidden = false;
  game._suppressPause = true;
  game.input.exitLock();
  renderLobby();
}

function showEnd(W, pay) {
  const won = pay.won;
  audio.play(won ? 'win' : 'lose');
  $('#end-title').textContent = won ? 'Delivered' : 'Job failed';
  const why = { health: "Dolores didn't make it through the trip.", tank: 'The tank came off the trailer.' }[pay.why] || '';
  const t = Math.floor(pay.time);
  $('#end-sub').textContent = won ? `Dolores is back in the sea. Job time ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}.` : why;
  const inv = $('#invoice');
  inv.innerHTML = '';
  for (const [label, v] of pay.lines) {
    const row = document.createElement('div');
    row.className = 'row';
    const a = document.createElement('span');
    a.textContent = label;
    const b = document.createElement('span');
    b.textContent = (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString();
    if (v < 0) b.className = 'neg';
    row.append(a, b);
    inv.appendChild(row);
  }
  const tot = document.createElement('div');
  tot.className = 'row total';
  const ta = document.createElement('span');
  ta.textContent = 'Settlement';
  const tb = document.createElement('span');
  tb.textContent = (pay.total < 0 ? '−$' : '$') + Math.abs(pay.total).toLocaleString();
  if (pay.total < 0) tb.className = 'neg';
  tot.append(ta, tb);
  inv.appendChild(tot);
  const stamp = document.createElement('div');
  stamp.className = 'stamp ' + (won ? 'won' : 'lost');
  stamp.textContent = won ? 'PAID' : 'VOID';
  inv.appendChild(stamp);
  $('#btn-again').hidden = !game.session.isHost;
  $('#end').hidden = false;
  game._suppressPause = true;
  game.input.exitLock();
}

// ------------------------------------------------------------------ co-op

async function connectLobby() {
  const note = $('#lobby-note');
  const hostBtn = $('#btn-host');
  // On claude.ai the page's own room connects signed-in crews. Anywhere else
  // (a static host like GitHub Pages or itch.io) crews meet with a password.
  if (!window.claude?.use) return passwordLobby();
  let r = null;
  try {
    r = await Promise.race([window.claude.use('room'), new Promise((res) => setTimeout(() => res(null), 11000))]);
  } catch {
    r = null;
  }
  if (!r) {
    hostBtn.disabled = true;
    note.textContent = 'Co-op on claude.ai needs you to be signed in. Solo play works anywhere.';
    return;
  }
  attachLobby(r);
}

function attachLobby(r) {
  const note = $('#lobby-note');
  const hostBtn = $('#btn-host');
  room = r;
  hostBtn.disabled = false;
  note.textContent = 'No open jobs yet. Host one, then ask your crew to open this page.';
  room.onPeers(() => renderLobby(), (e) => {
    note.textContent = e?.code === 'not_granted' ? 'Co-op is not available for your account on this page. Solo play still works.' : 'Lost the connection to the lobby. Solo play still works.';
    hostBtn.disabled = true;
  });
  room.onConnection((ok) => {
    if (!ok) note.textContent = 'Reconnecting to the lobby…';
    else renderLobby();
  });
}

function passwordLobby() {
  const form = $('#pwform');
  const input = $('#crewpw');
  const btn = $('#pwbtn');
  const note = $('#lobby-note');
  const hostBtn = $('#btn-host');
  form.hidden = false;
  hostBtn.disabled = true;
  $('#host-sub').textContent = 'Up to 4 crew. Everyone needs the crew password.';
  note.textContent = 'Enter the crew password to host or join a job. Solo play needs no password.';
  const connect = async (pw, auto) => {
    btn.disabled = true;
    note.textContent = 'Checking the password…';
    let ok = false;
    try {
      ok = await checkPassword(pw);
    } catch {
      ok = false;
    }
    if (!ok) {
      btn.disabled = false;
      note.textContent = auto ? 'Enter the crew password to host or join a job.' : "That password doesn't match. Check with whoever shared the game.";
      return;
    }
    store.set('crewpw', pw);
    note.textContent = 'Connecting to other crews…';
    try {
      const r = await connectMesh(pw);
      form.hidden = true;
      attachLobby(r);
      note.textContent = 'Connected. Host a job, or wait here for a crew to appear.';
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      note.textContent = 'Could not reach the matchmaking relays. Check your connection and try again.';
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    connect(input.value, false);
  });
  const saved = store.get('crewpw', '');
  if (saved) {
    input.value = saved;
    connect(saved, true);
  }
}

function renderLobby() {
  if (!room) return;
  const peers = room.peers();
  const me = peers.find((p) => p.isMe && p.sameTab);
  if (me) myPeer = me.peer;
  const list = $('#lobby-list');
  const jobs = peers.filter((p) => !(p.isMe && p.sameTab) && p.presence?.lob && p.presence.lob.v === PROTOCOL && p.presence.lob.open);
  list.innerHTML = '';
  for (const p of jobs) {
    const lob = p.presence.lob;
    const li = document.createElement('li');
    const who = document.createElement('div');
    who.className = 'who';
    const b = document.createElement('b');
    b.textContent = `${String(lob.name || 'Someone').slice(0, 18)}'s crew`;
    const s = document.createElement('span');
    s.textContent = `${lob.n || 1}/4 crew · code ${String(lob.code || '').slice(0, 6).toUpperCase()}${p.guest ? ' · guest' : ''}`;
    who.append(b, s);
    const btn = document.createElement('button');
    btn.textContent = (lob.n || 1) >= 4 ? 'Full' : 'Join';
    btn.disabled = (lob.n || 1) >= 4 || !!current;
    btn.addEventListener('click', () => joinJob(p.peer, lob.code));
    li.append(who, btn);
    list.appendChild(li);
  }
  if (!current) $('#lobby-note').textContent = jobs.length ? 'Pick a crew to join. The host runs the job; if they leave, it ends.' : 'No open jobs yet. Host one, then ask your crew to open this page.';
}

function makeCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let k = 0; k < 5; k++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

async function hostJob() {
  if (!room || current) return;
  const note = $('#lobby-note');
  renderLobby();
  if (!myPeer) {
    note.textContent = 'Still connecting to the lobby. Try again in a moment.';
    return;
  }
  const code = makeCode();
  note.textContent = 'Opening the job…';
  try {
    const named = await room.join('wl-' + code);
    const session = new RoomSession({ room: named, me: myPeer, host: myPeer, code, name: profile.name, color: profile.color });
    current = { session, code, host: true };
    game.opts.name = profile.name;
    game.opts.color = profile.color;
    game.opts.look = { ...profile.look };
    game.setSession(session, profile);
    advertise();
    enterPlay();
    hud.toast(`You're hosting crew ${code.toUpperCase()}. Friends open this page and pick your crew from the list.`);
  } catch (e) {
    note.textContent = e?.code === 'not_permitted' ? "Your account can't open co-op rooms on this page." : 'Could not open the job. Try again.';
  }
}

function advertise() {
  if (!current?.host || !room) return;
  const n = 1 + current.session.others().length;
  const W = game.W;
  room.presence({ lob: { v: PROTOCOL, code: current.code, name: profile.name, n, open: !W || W.ph === 'play' } }).catch(() => {});
  clearTimeout(advertise.t);
  advertise.t = setTimeout(advertise, 3000);
}

async function joinJob(hostPeer, code) {
  if (!room || current) return;
  const note = $('#lobby-note');
  renderLobby();
  if (!myPeer) {
    note.textContent = 'Still connecting to the lobby. Try again in a moment.';
    return;
  }
  note.textContent = 'Joining the crew…';
  try {
    const named = await room.join('wl-' + String(code).replace(/[^a-z0-9]/g, '').slice(0, 12));
    const session = new RoomSession({ room: named, me: myPeer, host: hostPeer, code, name: profile.name, color: profile.color });
    current = { session, code, host: false };
    game.opts.name = profile.name;
    game.opts.color = profile.color;
    game.opts.look = { ...profile.look };
    game.setSession(session, profile);
    enterPlay();
    hud.toast('You joined the crew. Press T to say hi.');
  } catch {
    note.textContent = 'Could not join that crew. It may have closed.';
    current = null;
  }
}

boot().catch((e) => {
  console.error(e);
  const m = $('#loading-msg');
  if (m) m.textContent = 'Something went wrong while loading. Reload the page to try again.';
});
