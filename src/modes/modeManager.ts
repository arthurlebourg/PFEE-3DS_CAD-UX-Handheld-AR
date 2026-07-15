import type { InteractionMode, ModeName } from './interactionMode.js';

/**
 * ModeManager: single source of truth for the active interaction mode.
 *
 * Switching modes runs the exit/enter hooks and notifies the UI through
 * onChange, so the mode indicator can never drift from the actual state.
 */
export class ModeManager {
    private readonly modes: Record<ModeName, InteractionMode>;
    private active: InteractionMode;
    private readonly onChange: (mode: ModeName) => void;

    constructor(
        edit: InteractionMode,
        inspect: InteractionMode,
        onChange: (mode: ModeName) => void,
    ) {
        this.modes = { edit, inspect };
        this.onChange = onChange;
        this.active = edit;
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

    public toggle(): void {
        this.setMode(this.active.name === 'edit' ? 'inspect' : 'edit');
    }
}
