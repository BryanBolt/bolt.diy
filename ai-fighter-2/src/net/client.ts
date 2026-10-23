import type { ClientMsg, ServerMsg } from '../../shared/protocol';

type Handler = (msg: ServerMsg) => void;

/** Client WebSocket minimal avec mesure de latence. */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Handler[]>();
  rtt = 0;
  connectedFlag = false;
  onClose: ((reason: string) => void) | null = null;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      const ws = this.ws;
      ws.onopen = () => {
        this.connectedFlag = true;
        this.send({ t: 'hello', v: 2 });
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('connexion impossible'));
        }
      };
      ws.onclose = (ev) => {
        this.connectedFlag = false;
        if (!settled) {
          settled = true;
          reject(new Error('connexion fermée'));
        }
        this.onClose?.(ev.reason || 'déconnecté');
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.t === 'ping') {
          this.send({ t: 'pong', ts: msg.ts });
          return;
        }
        if (msg.t === 'pong') {
          this.rtt = Math.max(0, performance.now() - msg.ts);
        }
        const list = this.handlers.get(msg.t);
        if (list) for (const h of list) h(msg);
        const all = this.handlers.get('*');
        if (all) for (const h of all) h(msg);
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(type: ServerMsg['t'] | '*', h: Handler): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(h);
    this.handlers.set(type, list);
    return () => {
      const l = this.handlers.get(type);
      if (l) this.handlers.set(type, l.filter((x) => x !== h));
    };
  }

  ping(): void {
    this.send({ t: 'ping', ts: performance.now() });
  }

  close(): void {
    this.onClose = null;
    this.ws?.close();
    this.ws = null;
    this.connectedFlag = false;
  }
}

/** URL WebSocket par défaut : même hôte que la page (proxy Vite en dev, serveur Node en prod). */
export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
