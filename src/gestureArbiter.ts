export const GestureType = {
    Button: 0,
    Pinch: 1,
    Joystick: 2,
    Select: 3,
} as const;

export type GestureType = (typeof GestureType)[keyof typeof GestureType];

const GESTURE_NAMES: Record<GestureType, string> = {
    [GestureType.Button]: 'Button',
    [GestureType.Pinch]: 'Pinch',
    [GestureType.Joystick]: 'Joystick',
    [GestureType.Select]: 'Select',
};

class GestureArbiter {
    private active: GestureType | null = null;

    public tryStart(gesture: GestureType): boolean {
        if (this.active === null || gesture < this.active) {
            this.active = gesture;
            return true;
        }
        return false;
    }

    public end(gesture: GestureType): void {
        if (this.active === gesture) {
            this.active = null;
        }
    }

    /** True if a strictly higher-precedence gesture currently owns the interaction. */
    public isBlocked(gesture: GestureType): boolean {
        return this.active !== null && this.active < gesture;
    }

    /** True if the given gesture is the current owner. */
    public isActive(gesture: GestureType): boolean {
        return this.active === gesture;
    }

    /** Force-clears whatever is active. Useful on session/teardown boundaries. */
    public reset(): void {
        this.active = null;
    }

    public debugName(gesture: GestureType | null = this.active): string {
        return gesture === null ? 'none' : GESTURE_NAMES[gesture];
    }
}

export const gestureArbiter = new GestureArbiter();
