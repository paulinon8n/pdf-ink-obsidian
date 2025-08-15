export type Handler<T extends any[] = any[]> = (...args: T) => void;

export class Emitter<Events extends Record<string, any>> {
  private map = new Map<keyof Events, Set<Handler>>();
  on<K extends keyof Events>(ev: K, cb: Handler<[Events[K]]>) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev)!.add(cb as any);
  }
  off<K extends keyof Events>(ev: K, cb: Handler<[Events[K]]>) {
    this.map.get(ev)?.delete(cb as any);
  }
  emit<K extends keyof Events>(ev: K, payload: Events[K]) {
    for (const cb of [...(this.map.get(ev) || [])]) (cb as any)(payload);
  }
}