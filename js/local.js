// Solo mode: runs the real game server inside the page, behind a WebSocket-shaped object.
// Used on static hosting (GitHub Pages) where there is no Node server to connect to.
import { Game, DT } from '../server/game.js';
import { DIFFICULTY } from '../shared/constants.js';

const ID = 1;
const RESULTS_SECONDS = 14;

export class LocalLink {
  constructor() {
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.player = null;
    this.phase = 'lobby';
    this.diff = 'normal';
    this.game = null;
    this.timer = null;
    setTimeout(() => {
      this.readyState = 1;
      this.emit({ t: 'welcome', id: ID, addrs: [], phase: this.phase, solo: true });
      this.onopen?.();
    }, 0);
  }

  // Deliver asynchronously, like a real socket, so handlers never re-enter each other.
  emit(o) {
    const data = JSON.stringify(o);
    queueMicrotask(() => this.onmessage?.({ data }));
  }

  lobby() {
    const players = this.player ? [{ ...this.player, ready: true, playing: this.phase === 'playing' }] : [];
    this.emit({ t: 'lobby', phase: this.phase, host: ID, diff: this.diff, players });
  }

  send(str) {
    let m;
    try {
      m = JSON.parse(str);
    } catch {
      return;
    }
    if (m.t === 'join') {
      this.player = { id: ID, name: String(m.name || 'Student').slice(0, 16), color: m.color };
      this.lobby();
    } else if (m.t === 'chat') {
      if (this.player) this.emit({ t: 'chat', id: ID, name: this.player.name, color: this.player.color, m: String(m.m || '').slice(0, 140) });
    } else if (this.phase === 'lobby') {
      if (m.t === 'diff' && DIFFICULTY[m.v]) {
        this.diff = m.v;
        this.lobby();
      } else if (m.t === 'start' && this.player) {
        this.start();
      } else if (m.t === 'ready') {
        this.lobby();
      }
    } else if (this.phase === 'playing' && this.game) {
      this.game.onMessage(ID, m);
    }
  }

  start() {
    this.phase = 'playing';
    this.game = new Game([this.player], this.diff, {
      broadcast: (o) => this.emit(o),
      onEnd: (summary) => this.end(summary),
    });
    this.emit(this.game.startPayload(ID));
    this.timer = setInterval(() => {
      try {
        this.game?.tick();
      } catch (e) {
        console.error(e);
      }
    }, DT * 1000);
    this.lobby();
  }

  end(summary) {
    clearInterval(this.timer);
    this.phase = 'results';
    this.emit(summary);
    setTimeout(() => {
      this.phase = 'lobby';
      this.game = null;
      this.lobby();
    }, RESULTS_SECONDS * 1000);
  }

  close() {
    clearInterval(this.timer);
    this.readyState = 3;
  }
}
