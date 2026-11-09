import type { InteractionMode, ModeName } from './interactionMode.js';

/**
 * ModeManager: single source of truth for the active interaction state.
 *
 * The state is never chosen by the user: main switches it whenever the
 * selection becomes empty or not. Switching runs the exit/enter hooks and
 * notifies the UI through onChange, so the toolbar can never drift from the
 * actual state.
 */
export class ModeManager {
    private readonly modes: Record<ModeName, InteractionMode>;
    private active: InteractionMode;
    private readonly onChange: (mode: ModeName) => void;

    constructor(
        sceneMode: InteractionMode,
        selectionMode: InteractionMode,
        onChange: (mode: ModeName) => void,
    ) {
        this.modes = { scene: sceneMode, selection: selectionMode };
        this.onChange = onChange;
        this.active = sceneMode;
        this.active.enter();
        this.onChange(this.active.name);
    }

    public get current(): InteractionMode {
        return this.active;
    }

    public get currentName(): ModeName {
        return this.active.name;
    }

    public setMode(name: ModeName): void {
        if (this.active.name === name) return;

        this.active.exit();
        this.active = this.modes[name];
        this.active.enter();
        this.onChange(name);
    }
}
