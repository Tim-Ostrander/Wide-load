// Keyboard + mouse input with pointer lock.
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set(); // went down this frame
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = 0;
    this.clicked = new Set();
    this.locked = false;
    this.enabled = true;
    this.blockKeys = false; // true while typing in a text field
    addEventListener('keydown', (e) => {
      if (this.blockKeys || isTyping(e)) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      this.buttons |= 1 << e.button;
      this.clicked.add(e.button);
    });
    addEventListener('mouseup', (e) => {
      this.buttons &= ~(1 << e.button);
    });
    addEventListener('mousemove', (e) => {
      if (this.locked || this.buttons & 4 || this.buttons & 2) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
    });
  }

  requestLock() {
    try {
      const p = this.el.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* pointer lock is optional */
    }
  }

  exitLock() {
    try {
      document.exitPointerLock?.();
    } catch {
      /* ignore */
    }
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }
  hit(code) {
    return this.enabled && this.pressed.has(code);
  }
  axis(neg, pos) {
    return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0);
  }
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
