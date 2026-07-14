/**
 * JoystickWidget: passive visual joystick for the scene rotation.
 *
 * Holds no touch listeners of its own — the GestureRecognizer classifies the
 * hold+drag gesture and the active mode drives this widget through
 * {@link show} / {@link move} / {@link hide}. While visible, an rAF loop
 * reports the horizontal stick deflection through the supplied callback.
 */
export class JoystickWidget {
    private root = document.createElement('div');
    private stick = document.createElement('div');

    private dx = 0;
    private visible = false;
    private animationFrame: number | null = null;

    private onHorizontalMove: (strength: number) => void;

    constructor(onHorizontalMove: (strength: number) => void) {
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

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.root);
    }

    /** Shows the joystick centered on the hold position and starts reporting. */
    public show(x: number, y: number): void {
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        this.root.style.display = 'block';
        this.visible = true;
        this.dx = 0;
        this.startLoop();
    }

    /** Updates the stick deflection from the hold's drag offset. */
    public move(dx: number, dy: number): void {
        this.dx = dx;

        const maxDistance = 40;
        const length = Math.hypot(dx, dy);
        const scale = length > maxDistance ? maxDistance / length : 1;

        this.stick.style.transform =
            `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`;
    }

    public hide(): void {
        if (this.animationFrame !== null) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        this.visible = false;
        this.dx = 0;
        this.root.style.display = 'none';
        this.stick.style.transform = 'translate(-50%, -50%)';
    }

    private startLoop(): void {
        const loop = () => {
            if (!this.visible) return;

            const deadZone = 6;
            const maxDistance = 40;

            if (Math.abs(this.dx) > deadZone) {
                const sign = Math.sign(this.dx);
                const normalized =
                    Math.min(Math.abs(this.dx), maxDistance) / maxDistance;
                // Cubic curve: fine control near the center, fast at the edge.
                const curved = normalized * normalized * normalized;

                this.onHorizontalMove(sign * curved);
            }

            this.animationFrame = requestAnimationFrame(loop);
        };

        this.animationFrame = requestAnimationFrame(loop);
    }
}
