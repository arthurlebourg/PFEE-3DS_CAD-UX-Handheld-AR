export class VirtualJoycon {
  private root = document.createElement('div');
  private stick = document.createElement('div');

  private startX = 0;
  private startY = 0;
  private lastX = 0;

  private active = false;
  private pressTimer: number | null = null;

private onHorizontalMove: (deltaX: number) => void;

constructor(onHorizontalMove: (deltaX: number) => void) {
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
      if (this.active) event.preventDefault();
    });

    parent.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];

      this.startX = touch.clientX;
      this.startY = touch.clientY;
      this.lastX = touch.clientX;

      this.pressTimer = window.setTimeout(() => {
        this.active = true;
        this.show(this.startX, this.startY);
      }, 400);
    });

    parent.addEventListener('touchmove', (event) => {
      if (!this.active) return;

      const touch = event.touches[0];

      const dx = touch.clientX - this.startX;
      const dy = touch.clientY - this.startY;

      const deltaX = touch.clientX - this.lastX;
      this.lastX = touch.clientX;

      this.moveStick(dx, dy);
      this.readDirection(deltaX);

      event.preventDefault();
    });

    parent.addEventListener('touchend', () => this.cancel());
    parent.addEventListener('touchcancel', () => this.cancel());
  }

  private show(x: number, y: number) {
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.root.style.display = 'block';
  }

  private moveStick(dx: number, dy: number) {
    const maxDistance = 40;
    const length = Math.hypot(dx, dy);
    const scale = length > maxDistance ? maxDistance / length : 1;

    this.stick.style.transform =
      `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
  }

  private readDirection(deltaX: number) {
    const threshold = 1;

    if (deltaX > threshold) {
      console.log('move right');
      this.onHorizontalMove(deltaX);
    } else if (deltaX < -threshold) {
      console.log('move left');
      this.onHorizontalMove(deltaX);
    }
  }

  private cancel() {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }

    this.active = false;
    this.root.style.display = 'none';
    this.stick.style.transform = 'translate(-50%, -50%)';
  }
}