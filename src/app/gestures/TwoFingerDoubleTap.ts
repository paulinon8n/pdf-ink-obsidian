
// Reconhecedor de "double-tap com 2 dedos" baseado em eventos touch.
// - Escuta no target (recomendado: window) em capture.
// - Não interfere com pinch/pan: só preventDefault quando o gesto é confirmado.
// - Chama onDoubleTap() no segundo tap válido.

type Point = { x: number; y: number };

export type TwoFingerDoubleTapOptions = {
  onDoubleTap: () => void;
  // Ajustes finos (valores padrão escolhidos para iPad/desktop)
  maxSingleTapDurationMs?: number;   // duração máxima de um único tap
  maxInterTapDelayMs?: number;       // intervalo máximo entre os dois taps
  maxMovePx?: number;                // deslocamento máx. do centroide em cada tap
};

export class TwoFingerDoubleTapRecognizer {
  private target: EventTarget;
  private opts: Required<TwoFingerDoubleTapOptions>;

  // Estado do "tap em andamento" (par de dedos pressionados)
  private tapStartTime: number | null = null;
  private tapStartCentroid: Point | null = null;
  private tapMoved = false;

  // Memória do último tap (para fechar o double-tap)
  private lastTapTime: number | null = null;

  // Handlers vinculados, para poder remover depois
  private onStartBound = (e: TouchEvent) => this.onStart(e);
  private onMoveBound  = (e: TouchEvent) => this.onMove(e);
  private onEndBound   = (e: TouchEvent) => this.onEnd(e);
  private onCancelBound= (e: TouchEvent) => this.onCancel(e);

  constructor(target: EventTarget, options: TwoFingerDoubleTapOptions) {
    this.target = target;
    this.opts = {
      onDoubleTap: options.onDoubleTap,
      maxSingleTapDurationMs: options.maxSingleTapDurationMs ?? 250,
      maxInterTapDelayMs: options.maxInterTapDelayMs ?? 300,
      maxMovePx: options.maxMovePx ?? 18,
    };
  }

  attach() {
    // capture:true para observar antes de listeners locais; passive:false pq podemos dar preventDefault ao confirmar gesto
    this.target.addEventListener("touchstart", this.onStartBound, { capture: true, passive: false });
    this.target.addEventListener("touchmove",  this.onMoveBound,  { capture: true, passive: false });
    this.target.addEventListener("touchend",   this.onEndBound,   { capture: true, passive: false });
    this.target.addEventListener("touchcancel",this.onCancelBound,{ capture: true, passive: false });
  }

  detach() {
    this.target.removeEventListener("touchstart", this.onStartBound as any, true);
    this.target.removeEventListener("touchmove",  this.onMoveBound as any,  true);
    this.target.removeEventListener("touchend",   this.onEndBound as any,   true);
    this.target.removeEventListener("touchcancel",this.onCancelBound as any,true);
    this.resetTap();
    this.lastTapTime = null;
  }

  private onStart(e: TouchEvent) {
    // Consideramos início de tentativa apenas com EXATAMENTE 2 toques
    if (e.touches.length === 2 && this.tapStartTime == null) {
      this.tapStartTime = performance.now();
      this.tapStartCentroid = this.centroid(e.touches);
      this.tapMoved = false;
    } else if (e.touches.length !== 2) {
      // Qualquer outra contagem anula a tentativa atual
      this.resetTap();
    }
  }

  private onMove(e: TouchEvent) {
    if (this.tapStartTime == null) return;
    if (e.touches.length !== 2) return;
    const c = this.centroid(e.touches);
    const s = this.tapStartCentroid!;
    const dx = c.x - s.x, dy = c.y - s.y;
    if ((dx * dx + dy * dy) > (this.opts.maxMovePx * this.opts.maxMovePx)) {
      this.tapMoved = true; // virou gesto de movimento/pinch
    }
  }

  private onEnd(e: TouchEvent) {
    if (this.tapStartTime == null) return;

    // Encerramos a tentativa atual quando solta um dos dedos
    if (e.touches.length < 2) {
      const duration = performance.now() - this.tapStartTime;
      const validTap = !this.tapMoved && duration <= this.opts.maxSingleTapDurationMs;

      // Reset do estado atual antes de decidir sobre double-tap
      this.resetTap();

      if (!validTap) return;

      const now = performance.now();
      if (this.lastTapTime != null && (now - this.lastTapTime) <= this.opts.maxInterTapDelayMs) {
        // Double-tap confirmado
        try {
          // Evita que o viewer trate como zoom/pan ao reconhecer o gesto pretendido
          e.preventDefault();
          e.stopPropagation();
        } catch {}
        this.lastTapTime = null;
        this.opts.onDoubleTap();
      } else {
        // Primeiro tap válido; aguarda o segundo
        this.lastTapTime = now;
      }
    }
  }

  private onCancel(_e: TouchEvent) {
    this.resetTap();
  }

  private centroid(touches: TouchList): Point {
    const a = touches[0], b = touches[1];
    return { x: (a.clientX + b.clientX) * 0.5, y: (a.clientY + b.clientY) * 0.5 };
  }

  private resetTap() {
    this.tapStartTime = null;
    this.tapStartCentroid = null;
    this.tapMoved = false;
  }
}