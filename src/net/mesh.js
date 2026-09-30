// Password co-op without accounts: the same room API the game uses on
// claude.ai (presence, onPeers, join), carried peer-to-peer over WebRTC by
// Trystero. Public Nostr relays only introduce peers to each other; the crew
// password decides which room you land in and encrypts that introduction.
// Game traffic then goes directly between players.
import { CREW_KEY } from './crewkey.js';

const enc = new TextEncoder();
const SEND_MS = 33; // coalesce presence to ~30 Hz, like the claude.ai room

async function pbkdf2Hex(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the typed password matches the crew password (only its hash ships with the game). */
export async function checkPassword(password) {
  if (!crypto?.subtle) return false;
  const h = await pbkdf2Hex(password.trim(), CREW_KEY.salt, CREW_KEY.iterations);
  return h === CREW_KEY.hash;
}

/** Connect to the password lobby. Resolves a room-like object. */
export async function connectMesh(password, { relays } = {}) {
  const pw = password.trim();
  const { joinRoom, selfId } = await import('../../vendor/trystero.js');
  const ns = await pbkdf2Hex(pw, CREW_KEY.salt + ':rooms', 20000);
  const config = { appId: 'wide-load-' + ns.slice(0, 24), password: pw };
  const urls = relays || window.__WL_RELAYS;
  if (urls) config.relayConfig = { urls };
  return new MeshRoom({ joinRoom, selfId, config }, '__lobby');
}

class MeshRoom {
  constructor(ctx, name) {
    this.ctx = ctx;
    this.name = name;
    this.me = ctx.selfId;
    this.mine = {};
    this.others = new Map(); // peer -> {presence, updatedAt}
    this.handlers = [];
    this.connHandlers = [];
    this.snap = null;
    this.lastSent = 0;
    this.pending = null;
    this.left = false;
    this.rooms = new Map();
    this.room = ctx.joinRoom(ctx.config, name, {
      onJoinError: (d) => {
        this.lastError = d?.error || 'join error';
      },
    });
    this.pres = this.room.makeAction('pres');
    this.pres.onMessage = (data, meta) => this._onPresence(meta?.peerId, data);
    this.room.onPeerJoin = (peer) => {
      // tell the newcomer who we are
      this.pres.send(this.mine, { target: peer }).catch(() => {});
      if (!this.others.has(peer)) {
        this.others.set(peer, { presence: Object.freeze({}), updatedAt: Date.now() });
        this._fire([peer], [], []);
      }
    };
    this.room.onPeerLeave = (peer) => {
      const old = this._find(peer);
      if (this.others.delete(peer)) this._fire([], old ? [old] : [], []);
    };
  }

  _onPresence(peer, data) {
    if (!peer || !data || typeof data !== 'object') return;
    const isNew = !this.others.has(peer);
    this.others.set(peer, { presence: Object.freeze(data), updatedAt: Date.now() });
    this._fire(isNew ? [peer] : [], [], isNew ? [] : [peer]);
  }

  _snapshot() {
    if (!this.snap) {
      const list = [Object.freeze({ peer: this.me, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...this.mine }), updatedAt: Date.now() })];
      for (const [peer, p] of this.others) list.push(Object.freeze({ peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: p.presence, updatedAt: p.updatedAt }));
      this.snap = Object.freeze(list);
    }
    return this.snap;
  }

  _find(peer) {
    return this._snapshot().find((p) => p.peer === peer);
  }

  _fire(joined, left, updated) {
    this.snap = null;
    const peers = this._snapshot();
    const change = { peers, joined: joined.map((p) => this._find(p)).filter(Boolean), left, updated: updated.map((p) => this._find(p)).filter(Boolean) };
    for (const h of this.handlers) {
      try {
        h(change);
      } catch (e) {
        console.error(e);
      }
    }
  }

  // ---- the room API subset Wide Load uses --------------------------------

  presence(patch) {
    if (this.left) return Promise.reject({ code: 'invalid_argument', message: 'room left' });
    const next = { ...this.mine };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    this.mine = next;
    this.snap = null;
    const now = performance.now();
    const flush = () => {
      this.pending = null;
      this.lastSent = performance.now();
      this.pres.send(this.mine).catch(() => {});
    };
    if (now - this.lastSent >= SEND_MS) flush();
    else if (!this.pending) this.pending = setTimeout(flush, SEND_MS - (now - this.lastSent));
    return Promise.resolve();
  }

  peers() {
    return this._snapshot();
  }

  onPeers(h) {
    this.handlers.push(h);
    setTimeout(() => h({ peers: this._snapshot(), joined: this._snapshot(), left: [], updated: [] }), 0);
    return () => {
      const i = this.handlers.indexOf(h);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  connected() {
    return !this.left;
  }

  onConnection(h) {
    this.connHandlers.push(h);
    setTimeout(() => h(!this.left), 0);
    return () => {};
  }

  emit() {
    return Promise.resolve();
  }

  on() {
    return () => {};
  }

  join(name) {
    let r = this.rooms.get(name);
    if (!r || r.left) {
      r = new MeshRoom(this.ctx, name);
      this.rooms.set(name, r);
    }
    return Promise.resolve(r);
  }

  async leave() {
    if (this.left) return;
    this.left = true;
    clearTimeout(this.pending);
    try {
      await this.room.leave();
    } catch {
      /* already gone */
    }
  }
}
