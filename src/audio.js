// Procedural sound: every effect is synthesised with WebAudio, no files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this._lastPlay = {};
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.comp = ctx.createDynamicsCompressor();
    this.master.connect(this.comp).connect(ctx.destination);
    this.noiseBuf = this._noise(2);
    this.reverb = this._makeReverb();
    this.reverb.connect(this.master);
    this._engine();
    this._loops();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  _noise(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeReverb() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2.2;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    conv.connect(g);
    this.reverbIn = conv;
    return g;
  }

  _noiseSrc(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  _engine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 2;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    const n = this._noiseSrc();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    n.connect(nf).connect(ng).connect(lp);
    lp.connect(out).connect(this.master);
    o1.start();
    o2.start();
    n.start();
    this.eng = { out, lp, o1, o2 };
    // air horn
    const hg = ctx.createGain();
    hg.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1800;
    for (const f of [185, 233, 277]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
    }
    hf.connect(hg).connect(this.master);
    this.horn = hg;
  }

  _loop(make) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    make(g);
    g.connect(this.master);
    return g;
  }

  _loops() {
    const ctx = this.ctx;
    // chainsaw
    this.saw = this._loop((g) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 118;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lg = ctx.createGain();
      lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 0.7;
      o.connect(f).connect(g);
      const n = this._noiseSrc();
      const nf = ctx.createBiquadFilter();
      nf.type = 'highpass';
      nf.frequency.value = 2500;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      n.connect(nf).connect(ng).connect(g);
      o.start();
      lfo.start();
      n.start();
    });
    // pouring liquid
    this.pour = this._loop((g) => {
      const n = this._noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 700;
      f.Q.value = 1.2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lg = ctx.createGain();
      lg.gain.value = 250;
      lfo.connect(lg).connect(f.frequency);
      n.connect(f).connect(g);
      n.start();
      lfo.start();
    });
    // sea and wind
    this.sea = this._loop((g) => {
      const n = this._noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12;
      const lg = ctx.createGain();
      lg.gain.value = 0.45;
      lfo.connect(lg).connect(am.gain);
      n.connect(f).connect(am).connect(g);
      n.start();
      lfo.start();
    });
    this.wind = this._loop((g) => {
      const n = this._noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 380;
      f.Q.value = 0.4;
      n.connect(f).connect(g);
      n.start();
    });
    // bridge creak
    this.creak = this._loop((g) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 62;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.3;
      const lg = ctx.createGain();
      lg.gain.value = 30;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 300;
      f.Q.value = 6;
      o.connect(f).connect(g);
      o.start();
      lfo.start();
    });
    // water sloshing in the tank
    this.slosh = this._loop((g) => {
      const n = this._noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      n.connect(f).connect(g);
      n.start();
    });
    this.wind.gain.value = 0.04;
    this.ratchetT = 0;
    this.whaleT = 4;
  }

  _env(node, t, a, d, peak) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _burst({ freq = 800, type = 'lowpass', q = 1, dur = 0.2, peak = 0.5, sweep, rev = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSrc(false);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, 0.005, dur, peak);
    n.connect(f).connect(g).connect(this.master);
    if (rev) g.connect(this.reverbIn);
    n.start(t);
    n.stop(t + dur + 0.1);
  }

  _tone({ freq = 440, to, type = 'sine', dur = 0.2, peak = 0.3, delay = 0, rev = 0, vib = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    if (vib) {
      const l = ctx.createOscillator();
      l.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = vib;
      l.connect(lg).connect(o.frequency);
      l.start(t);
      l.stop(t + dur + 0.1);
    }
    const g = ctx.createGain();
    this._env(g, t, Math.min(0.05, dur / 4), dur, peak);
    o.connect(g).connect(this.master);
    if (rev) {
      const rg = this.ctx.createGain();
      rg.gain.value = rev;
      g.connect(rg).connect(this.reverbIn);
    }
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  song() {
    // a beluga's chirps and whistles
    const notes = [[900, 1400, 0.35], [1400, 1100, 0.25], [700, 1600, 0.5], [1600, 1250, 0.3], [1250, 1900, 0.45], [800, 600, 0.6]];
    let d = 0;
    for (const [a, b, dur] of notes) {
      this._tone({ freq: a, to: b, dur, peak: 0.12, delay: d, rev: 1, vib: 18 });
      d += dur * 0.8 + 0.05;
    }
  }

  chirp() {
    const a = 700 + Math.random() * 900;
    this._tone({ freq: a, to: a * (0.7 + Math.random() * 0.8), dur: 0.25 + Math.random() * 0.3, peak: 0.05, rev: 1, vib: 14 });
  }

  play(name) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - (this._lastPlay[name] || 0) < 60) return;
    this._lastPlay[name] = now;
    switch (name) {
      case 'thud':
        this._tone({ freq: 110, to: 45, dur: 0.3, peak: 0.5 });
        this._burst({ freq: 300, dur: 0.15, peak: 0.25 });
        break;
      case 'crash':
        this._burst({ freq: 1500, sweep: 120, dur: 1.2, peak: 0.7, rev: 1 });
        this._tone({ freq: 80, to: 35, dur: 0.8, peak: 0.6 });
        break;
      case 'snap':
        this._burst({ freq: 3000, type: 'highpass', dur: 0.08, peak: 0.6 });
        this._tone({ freq: 380, to: 140, type: 'triangle', dur: 0.35, peak: 0.25 });
        break;
      case 'blowout':
        this._burst({ freq: 4000, sweep: 200, dur: 0.6, peak: 0.9 });
        break;
      case 'zap':
        for (let i = 0; i < 8; i++) setTimeout(() => this._burst({ freq: 2500 + Math.random() * 3000, type: 'bandpass', q: 3, dur: 0.06, peak: 0.6 }), i * 70 + Math.random() * 40);
        this._tone({ freq: 60, type: 'sawtooth', dur: 0.8, peak: 0.25 });
        break;
      case 'splash':
        this._burst({ freq: 1800, sweep: 300, type: 'bandpass', q: 0.8, dur: 0.5, peak: 0.35 });
        break;
      case 'pick':
        this._tone({ freq: 520, to: 700, type: 'triangle', dur: 0.06, peak: 0.15 });
        break;
      case 'drop':
        this._tone({ freq: 180, to: 80, dur: 0.12, peak: 0.25 });
        break;
      case 'door':
        this._burst({ freq: 900, dur: 0.05, peak: 0.3 });
        this._tone({ freq: 120, to: 70, dur: 0.12, peak: 0.3, delay: 0.05 });
        break;
      case 'step':
        this._burst({ freq: 500, dur: 0.06, peak: 0.2 });
        break;
      case 'ping':
        this._tone({ freq: 880, dur: 0.12, peak: 0.18 });
        this._tone({ freq: 1320, dur: 0.18, peak: 0.14, delay: 0.1 });
        break;
      case 'radio':
        this._burst({ freq: 2200, type: 'bandpass', q: 2, dur: 0.18, peak: 0.2 });
        this._tone({ freq: 1000, dur: 0.08, peak: 0.08, delay: 0.18 });
        break;
      case 'done':
        this._tone({ freq: 660, dur: 0.1, peak: 0.15 });
        this._tone({ freq: 990, dur: 0.2, peak: 0.12, delay: 0.08 });
        break;
      case 'song':
        this.song();
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, k) => this._tone({ freq: f, type: 'triangle', dur: 0.35, peak: 0.15, delay: k * 0.14, rev: 0.6 }));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, k) => this._tone({ freq: f, type: 'triangle', dur: 0.5, peak: 0.15, delay: k * 0.2, rev: 0.6 }));
        break;
    }
  }

  update(dt, m) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const e = this.eng;
    const rpm = m.rpm || 0;
    e.o1.frequency.setTargetAtTime(34 + rpm * 62, t, 0.08);
    e.o2.frequency.setTargetAtTime(17 + rpm * 31, t, 0.08);
    e.lp.frequency.setTargetAtTime(260 + rpm * 900, t, 0.1);
    const menu = m.mode !== 'play';
    e.out.gain.setTargetAtTime((menu ? 0.05 : 0.18) * m.engine * (0.5 + rpm), t, 0.1);
    this.horn.gain.setTargetAtTime(m.horn ? 0.16 : 0, t, 0.02);
    this.saw.gain.setTargetAtTime(m.chainsaw ? 0.16 : 0, t, 0.05);
    this.pour.gain.setTargetAtTime(m.pour ? 0.12 : 0, t, 0.05);
    this.sea.gain.setTargetAtTime(0.02 + m.sea * 0.18, t, 0.3);
    this.creak.gain.setTargetAtTime(m.creak > 0.05 ? 0.12 : 0, t, 0.1);
    this.slosh.gain.setTargetAtTime(Math.min(0.12, m.slosh * 0.06), t, 0.1);
    this.wind.gain.setTargetAtTime(0.03 + Math.min(0.05, m.speed * 0.004), t, 0.3);
    if (m.ratchet) {
      this.ratchetT -= dt;
      if (this.ratchetT <= 0) {
        this.ratchetT = 0.12;
        this._burst({ freq: 3500, type: 'highpass', dur: 0.025, peak: 0.25 });
      }
    }
    if (m.whale > 0.05) {
      this.whaleT -= dt;
      if (this.whaleT <= 0) {
        this.whaleT = 5 + Math.random() * 9;
        if (Math.random() < 0.3) this.song();
        else this.chirp();
      }
    }
  }
}
