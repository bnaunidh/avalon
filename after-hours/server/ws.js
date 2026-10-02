// Minimal dependency-free WebSocket server (RFC 6455): text frames, ping/pong, close.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 256 * 1024;

export function acceptUpgrade(req, socket, head, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  const ws = new WSConn(socket);
  onConnection(ws, req);
  if (head && head.length) ws._onData(head);
}

export class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this.close(1009);
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009);
      const maskLen = masked ? 4 : 0;
      if (b.length < off + maskLen + len) return;
      let payload = b.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = b.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = b.subarray(off + maskLen + len);
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, payload) {
    if (op === 0x8) return this.close(1000);
    if (op === 0x9) return this._send(0xa, payload);
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2) {
      this.fragOp = op;
      this.frags = [payload];
    } else if (op === 0x0) {
      this.frags.push(payload);
      if (this.frags.reduce((n, f) => n + f.length, 0) > MAX_PAYLOAD) return this.close(1009);
    } else {
      return this.close(1002);
    }
    if (!fin) return;
    const data = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
    this.frags = [];
    if (this.fragOp === 0x1) this.emit('message', data.toString('utf8'));
  }

  send(str) {
    if (!this.open) return;
    // Drop frames for clients that stopped reading rather than buffering forever.
    if (this.socket.writableLength > 4 * 1024 * 1024) return;
    this._send(0x1, Buffer.from(str, 'utf8'));
  }

  _send(op, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | op, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this._closed();
    }
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    this._send(0x8, p);
    this.open = false;
    this.socket.end();
    this.emit('close');
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.emit('close');
  }
}
