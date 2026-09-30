// The in-game HUD: DOM overlays updated from a view model each frame.
import { HAT_COLORS } from '../player.js';
import { QUICK_CHAT } from '../game.js';

const $ = (s) => document.querySelector(s);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export class Hud {
  constructor() {
    this.root = $('#hud');
    this.typing = false;
    this.quickChatOpen = false;
    this.cache = {};
    this.el = {
      objTitle: $('.obj-title'),
      objDetail: $('.obj-detail'),
      objDist: $('.obj-dist'),
      clock: $('.jobclock'),
      net: $('#netinfo'),
      toasts: $('#toasts'),
      crew: $('#crewlist'),
      chat: $('#chatlog'),
      health: $('#dolores .health'),
      water: $('#dolores .water'),
      straps: [...document.querySelectorAll('#dolores .straps i')],
      mood: $('#dolores .mood'),
      speed: $('#rigpanel .speed b'),
      fuel: $('#rigpanel .fuel'),
      bed: $('#chip-bed'),
      tiller: $('#chip-tiller'),
      fines: $('#chip-fines'),
      smokes: $('#chip-smokes'),
      tires: $('#tires'),
      prompt: $('#prompt'),
      seathint: $('#seathint'),
      crosshair: $('#crosshair'),
      quick: $('#quickchat'),
      waiting: $('#waiting'),
      clicklook: $('#clicklook'),
      map: $('#minimap'),
    };
    for (let k = 0; k < 10; k++) this.el.tires.appendChild(document.createElement('i'));
    this.tireEls = [...this.el.tires.children];
    this.el.quick.innerHTML = QUICK_CHAT.map((t, k) => `<div><span class="key">${k + 1}</span><span>${t}</span></div>`).join('');
    this.mapCtx = this.el.map.getContext('2d');
    this.roadCanvas = null;
    this.seat = null;
    this.seatHint(null);
    this.onEnd = null;
    this.onSay = null;
    this.chatForm = $('#chatform');
    this.chatInput = $('#chatinput');
    addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' || this.root.hidden) return;
      if (!this.typing) {
        e.preventDefault();
        this.openChat();
      }
    });
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, 80);
      if (text && this.onSay) this.onSay(text);
      this.closeChat();
    });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        this.closeChat();
      }
    });
    this.chatInput.addEventListener('blur', () => this.closeChat());
  }

  openChat() {
    this.typing = true;
    this.chatForm.hidden = false;
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    if (!this.typing) return;
    this.typing = false;
    this.chatForm.hidden = true;
    this.chatInput.blur();
    this.onChatClosed?.();
  }

  show(v) {
    this.root.hidden = !v;
  }

  _set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 5200);
    setTimeout(() => d.remove(), 5700);
  }

  chat(name, color, text) {
    const d = document.createElement('div');
    const n = document.createElement('b');
    n.textContent = name + ': ';
    n.style.color = hex(HAT_COLORS[color % HAT_COLORS.length]);
    d.append(n, document.createTextNode(text));
    this.el.chat.appendChild(d);
    while (this.el.chat.children.length > 5) this.el.chat.firstChild.remove();
    setTimeout(() => d.remove(), 14000);
  }

  toggleQuickChat(force) {
    this.quickChatOpen = force !== undefined ? force : !this.quickChatOpen;
    this.el.quick.hidden = !this.quickChatOpen;
  }

  seatHint(seat) {
    this.seat = seat;
    const k = (s) => `<span class="key">${s}</span>`;
    let html;
    if (seat === 'driver') html = `<span>${k('W')}${k('S')} drive</span><span>${k('A')}${k('D')} steer</span><span>${k('B')} bed up/down</span><span>${k('X')} trailer auto-steer</span><span>${k('H')} horn</span><span>${k('F')} get out</span>`;
    else if (seat === 'tiller') html = `<span>${k('A')}${k('D')} steer the trailer wheels</span><span>${k('T')} quick chat</span><span>${k('F')} get out</span>`;
    else if (seat === 'passenger') html = `<span>${k('G')} ping</span><span>${k('T')} quick chat</span><span>${k('F')} get out</span>`;
    else html = `<span>${k('E')} use</span><span>${k('Q')} drop</span><span>${k('F')} seats</span><span>${k('G')} ping</span><span>${k('T')} quick chat</span><span>${k('Esc')} pause</span>`;
    this.el.seathint.innerHTML = html;
  }

  hostLost() {
    $('#hostlost').hidden = false;
  }

  showEnd(W, pay) {
    if (this.onEnd) this.onEnd(W, pay);
  }

  update(m) {
    if (m.mode !== 'play') return;
    const el = this.el;
    // objective
    const o = m.objective;
    this._set('ot', el.objTitle, 'textContent', o.title);
    this._set('od', el.objDetail, 'textContent', o.detail);
    this._set('odist', el.objDist, 'textContent', o.dist > 20 ? (o.dist >= 1000 ? (o.dist / 1000).toFixed(1) + ' km' : Math.round(o.dist / 10) * 10 + ' m') : o.dist !== undefined ? 'HERE' : '');
    const t = Math.floor(m.jobTime);
    this._set('clock', el.clock, 'innerHTML', `JOB TIME <b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b>`);
    this._set('net', el.net, 'innerHTML', m.solo ? '' : `CREW CODE <b>${m.code || ''}</b>${m.connected ? '' : ' · reconnecting…'}`);
    this.el.waiting.hidden = m.ready;
    // Dolores
    const r = m.rig;
    this._meter('h', el.health, r.health);
    this._meter('w', el.water, r.water);
    r.straps.forEach((v, k) => {
      const cls = v <= 0 ? 'gone' : v < 25 ? 'bad' : v < 60 ? 'worn' : '';
      this._set('s' + k, el.straps[k], 'className', cls);
    });
    this._set('mood', el.mood, 'textContent', mood(r));
    // rig
    this._set('spd', el.speed, 'textContent', String(Math.round(r.kmh)));
    this._meter('f', el.fuel, r.fuel);
    const bedDown = r.bedTarget > 0.5;
    const moving = Math.abs(r.bed - r.bedTarget) > 0.02;
    this._set('bed', el.bed, 'textContent', moving ? (bedDown ? 'BED LOWERING' : 'BED RAISING') : bedDown ? 'BED DOWN · 12 KM/H' : 'BED UP');
    this._set('bedc', el.bed, 'className', 'chip' + (bedDown ? ' on' : ''));
    this._set('til', el.tiller, 'textContent', r.tillerAuto ? 'TRAILER AUTO' : 'TRAILER MANUAL');
    this._set('fin', el.fines, 'textContent', `FINES $${m.fines.toLocaleString()}`);
    this._set('finc', el.fines, 'className', 'chip' + (m.fines > 0 ? ' warn' : ''));
    const sm = m.smokes;
    this._set('smk', el.smokes, 'textContent', sm.t > 0 ? `SMOKING ${sm.t}s · ${sm.n} LEFT` : `SMOKES ${sm.n}`);
    this._set('smkc', el.smokes, 'className', 'chip' + (sm.t > 0 ? ' on' : sm.n === 0 ? ' warn' : ''));
    r.tires.forEach((v, k) => this._set('t' + k, this.tireEls[k], 'className', v <= 0 ? 'flat' : v < 60 ? 'hurt' : ''));
    // crew list
    const crewKey = m.players.map((p) => `${p.n}|${p.c}|${p.seat}|${p.held}|${p.host}`).join(';');
    if (this.cache.crew !== crewKey) {
      this.cache.crew = crewKey;
      el.crew.innerHTML = '';
      if (m.players.length > 1 || !m.solo) {
        for (const p of m.players) {
          const d = document.createElement('div');
          d.className = 'member';
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = hex(HAT_COLORS[p.c % HAT_COLORS.length]);
          const nm = document.createElement('span');
          nm.className = 'nm';
          nm.textContent = p.n + (p.me ? ' (you)' : '') + (p.host ? ' ★' : '');
          const st = document.createElement('span');
          st.className = 'st';
          st.textContent = p.seat ? { driver: 'driving', passenger: 'riding', tiller: 'tiller' }[p.seat] : p.held ? p.held : 'on foot';
          d.append(dot, nm, st);
          el.crew.appendChild(d);
        }
      }
    }
    // prompt
    const lines = [];
    if (m.hold) lines.push(`<div class="prompt-line"><span class="key">E</span><span>${esc(m.hold.label)}</span></div><div class="holdbar"><i style="width:${Math.round(m.hold.t * 100)}%"></i></div>`);
    else {
      if (m.cand.e) lines.push(`<div class="prompt-line${m.cand.e.disabled ? ' disabled' : ''}"><span class="key">E</span><span>${esc(m.cand.e.label)}${m.cand.e.hold ? ' <span style="opacity:.7">(hold)</span>' : ''}</span></div>`);
      if (m.cand.f) lines.push(`<div class="prompt-line${m.cand.f.disabled ? ' disabled' : ''}"><span class="key">F</span><span>${esc(m.cand.f.label)}</span></div>`);
      if (m.held && !m.seat) lines.push(`<div class="prompt-line" style="font-weight:600;font-size:13px"><span class="key">Q</span><span>Drop the ${esc(m.held)}</span></div>`);
    }
    this._set('prompt', el.prompt, 'innerHTML', lines.join(''));
    el.crosshair.hidden = !!m.seat;
    this._drawMap(m.map);
  }

  _meter(key, el, v) {
    const pct = Math.max(0, Math.min(100, v));
    const w = Math.round(pct);
    if (this.cache[key] === w) return;
    this.cache[key] = w;
    el.querySelector('i').style.width = w + '%';
    el.lastElementChild.textContent = w + '%';
    el.classList.toggle('low', pct < 30);
  }

  _drawMap(mp) {
    const ctx = this.mapCtx;
    const W = this.el.map.width, H = this.el.map.height;
    const road = mp.road;
    if (!this.roadCanvas) {
      // pre-render the whole route at 1 px per metre
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const g = c.getContext('2d');
      g.fillStyle = '#5f9a47';
      g.fillRect(0, 0, 1024, 1024);
      // sea
      const t = mp.structures.terrain;
      const img = g.getImageData(0, 0, 1024, 1024);
      for (let y = 0; y < 1024; y += 2) {
        for (let x = 0; x < 1024; x += 2) {
          const h = t.heightAt(x - 512, y - 512);
          let col = null;
          if (h < 0.1) col = [63, 150, 214];
          else if (h < 2.6) col = [240, 216, 150];
          else if (h > 55) col = [196, 164, 120];
          if (!col) continue;
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const k = ((y + dy) * 1024 + x + dx) * 4;
            img.data[k] = col[0];
            img.data[k + 1] = col[1];
            img.data[k + 2] = col[2];
          }
        }
      }
      g.putImageData(img, 0, 0);
      g.strokeStyle = '#d9d2bd';
      g.lineWidth = 7;
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < road.count; i += 2) {
        const x = road.x[i] + 512, y = road.z[i] + 512;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      // obstacle markers
      const S = mp.structures;
      const mark = (p, label) => {
        g.fillStyle = '#f5c518';
        g.beginPath();
        g.arc(p.x + 512, p.z + 512, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#141414';
        g.font = '900 12px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, p.x + 512, p.z + 513);
      };
      mark(S.spots.log, '!');
      mark(S.spots.lines.p, '⚡');
      mark(S.spots.overpass.p, '▲');
      mark(S.spots.pump, '⛽');
      mark(S.spots.bridge.p, '!');
      mark(S.spots.washout.p, '!');
      mark(S.spots.release.p, '★');
      this.roadCanvas = c;
    }
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    const scale = 1.35; // px per metre
    const focus = this.seat ? mp.truck : mp.me;
    ctx.translate(W / 2, H / 2);
    ctx.rotate(mp.camYaw);
    ctx.scale(scale, scale);
    ctx.drawImage(this.roadCanvas, -(focus.x + 512), -(focus.z + 512));
    // rig
    const drawBox = (p, yaw, len, wid, color) => {
      ctx.save();
      ctx.translate(p.x - focus.x, p.z - focus.z);
      ctx.rotate(-yaw);
      ctx.fillStyle = color;
      ctx.fillRect(-wid / 2, -len / 2, wid, len);
      ctx.restore();
    };
    const tq = mp.trailer;
    drawBox(tq, Math.atan2(mp.truck.x - tq.x, mp.truck.z - tq.z), 13, 3.6, '#f5c518');
    drawBox(mp.truck, mp.heading, 8, 3.2, '#e8572a');
    for (const o of mp.others) {
      if (!o.pos) continue;
      ctx.fillStyle = hex(HAT_COLORS[o.c % HAT_COLORS.length]);
      ctx.beginPath();
      ctx.arc(o.pos.x - focus.x, o.pos.z - focus.z, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // me
    ctx.save();
    ctx.translate(mp.me.x - focus.x, mp.me.z - focus.z);
    ctx.rotate(-mp.myYaw);
    ctx.fillStyle = '#f2eee1';
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(3.4, -3.4);
    ctx.lineTo(-3.4, -3.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // north marker
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(mp.camYaw);
    ctx.fillStyle = '#f2eee1';
    ctx.font = '700 22px "Overpass Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -H / 2 + 26);
    ctx.restore();
  }
}

function mood(r) {
  if (!r.tank) return 'Dolores is no longer on the trailer.';
  if (r.health < 25) return 'Dolores is in real trouble.';
  if (r.water < 30) return 'Dolores is drying out. Find water.';
  if (r.slosh > 0.8) return 'Dolores does not enjoy this sloshing.';
  if (r.straps.some((s) => s <= 0)) return 'Dolores can feel the tank shifting.';
  if (r.kmh > 30) return 'Dolores squeaks at the speed.';
  if (r.health > 85) return 'Dolores is humming to herself.';
  return 'Dolores is holding up.';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
