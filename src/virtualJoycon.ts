export class VirtualJoycon {
  private root = document.createElement('div');
  private stick = document.createElement('div');

  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  private active = false;
  private wasUsed = false;
  private pressTimer: number | null = null;
  private animationFrame: number | null = null;

  private onHorizontalMove: (direction: number) => void;

  constructor(onHorizontalMove: (direction: number) => void) {
    this.onHorizontalMove = onHorizontalMove;

    this.root.style.cssText = `
      position:absolute;
      width:120px;
      height:120px;
      border-radius:50%;
      border:3px solid white;
      background:rgba(0,0,0,0.25);
      z-index:200;
      display:none;
      pointer-events:none;
      transform:translate(-50%, -50%);
    `;

    this.stick.style.cssText = `
      position:absolute;
      width:45px;
      height:45px;
      border-radius:50%;
      background:rgba(255,255,255,0.7);
      left:50%;
      top:50%;
      transform:translate(-50%, -50%);
    `;

    this.root.appendChild(this.stick);
  }

  public attach(parent: HTMLElement) {
    parent.appendChild(this.root);

    parent.addEventListener('beforexrselect', (event) => {
      if (this.active || this.wasUsed) {
        event.preventDefault();
      }
    });

    parent.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];

      this.startX = touch.clientX;
      this.startY = touch.clientY;
      this.currentX = touch.clientX;
      this.currentY = touch.clientY;

      this.wasUsed = false;

      this.pressTimer = window.setTimeout(() => {
        this.active = true;
        this.wasUsed = true;
        this.show(this.startX, this.startY);
        this.startLoop();
      }, 400);
    }, { passive: false });

    parent.addEventListener('touchmove', (event) => {
      if (!this.active) return;

      const touch = event.touches[0];

      this.currentX = touch.clientX;
      this.currentY = touch.clientY;

      const dx = this.currentX - this.startX;
      const dy = this.currentY - this.startY;

      this.moveStick(dx, dy);

      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });

    parent.addEventListener('touchend', (event) => {
      if (this.active || this.wasUsed) {
        event.preventDefault();
        event.stopPropagation();
      }

      this.cancel();
    }, { passive: false });

    parent.addEventListener('touchcancel', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }, { passive: false });
  }

  public consumeTap(): boolean {
    if (!this.wasUsed) return false;

    this.wasUsed = false;
    return true;
  }

  private show(x: number, y: number) {
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.root.style.display = 'block';
  }

  private startLoop() {
    const loop = () => {
      if (!this.active) return;

      const dx = this.currentX - this.startX;

      const deadZone = 8;
      const maxDistance = 40;

      if (Math.abs(dx) > deadZone) {
        const strength = Math.max(-1, Math.min(1, dx / maxDistance));

        this.onHorizontalMove(strength);
      }

      this.animationFrame = requestAnimationFrame(loop);
    };

    this.animationFrame = requestAnimationFrame(loop);
  }

  private moveStick(dx: number, dy: number) {
    const maxDistance = 40;
    const length = Math.hypot(dx, dy);
    const scale = length > maxDistance ? maxDistance / length : 1;

    this.stick.style.transform =
      `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
  }

  private cancel() {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.active = false;
    this.root.style.display = 'none';
    this.stick.style.transform = 'translate(-50%, -50%)';
  }
}