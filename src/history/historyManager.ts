import type { ModeName } from '../modes/interactionMode.js';

/**
 * Interface representing an undoable and redoable action.
 */
export interface HistoryAction {
    readonly description: string;
    undo(): void;
    redo(): void;
}

/**
 * Standard undo/redo stack for a specific context or mode.
 */
export class HistoryStack {
    private undoStack: HistoryAction[] = [];
    private redoStack: HistoryAction[] = [];
    private readonly maxDepth: number;
    private readonly onChange?: () => void;

    constructor(maxDepth = 50, onChange?: () => void) {
        this.maxDepth = maxDepth;
        this.onChange = onChange;
    }

    public get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    public get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Pushes a new action onto the stack. Clears the redo stack.
     */
    public push(action: HistoryAction): void {
        this.undoStack.push(action);
        if (this.undoStack.length > this.maxDepth) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.onChange?.();
    }

    /**
     * Undoes the last action. Returns true if an action was undone.
     */
    public undo(): boolean {
        const action = this.undoStack.pop();
        if (!action) return false;

        action.undo();
        this.redoStack.push(action);
        this.onChange?.();
        return true;
    }

    /**
     * Redoes the last undone action. Returns true if an action was redone.
     */
    public redo(): boolean {
        const action = this.redoStack.pop();
        if (!action) return false;

        action.redo();
        this.undoStack.push(action);
        this.onChange?.();
        return true;
    }

    /**
     * Clears both undo and redo stacks.
     */
    public clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.onChange?.();
    }
}

/**
 * Manages separate history stacks for each interaction mode (Edit and Inspect).
 * Notifies listeners when the active mode's undo/redo availability changes.
 */
export class ModeHistoryManager {
    private readonly stacks: Record<ModeName, HistoryStack>;
    private activeMode: ModeName;
    private readonly onStateChange: (canUndo: boolean, canRedo: boolean) => void;

    constructor(
        initialMode: ModeName,
        onStateChange: (canUndo: boolean, canRedo: boolean) => void,
        maxDepth = 50,
    ) {
        this.activeMode = initialMode;
        this.onStateChange = onStateChange;

        const notify = () => {
            this.notifyActiveState();
        };

        this.stacks = {
            edit: new HistoryStack(maxDepth, () => {
                if (this.activeMode === 'edit') notify();
            }),
            inspect: new HistoryStack(maxDepth, () => {
                if (this.activeMode === 'inspect') notify();
            }),
        };

        this.notifyActiveState();
    }

    public get currentMode(): ModeName {
        return this.activeMode;
    }

    public setMode(mode: ModeName): void {
        if (this.activeMode === mode) return;
        this.activeMode = mode;
        this.notifyActiveState();
    }

    public get activeStack(): HistoryStack {
        return this.stacks[this.activeMode];
    }

    public getStack(mode: ModeName): HistoryStack {
        return this.stacks[mode];
    }

    public push(mode: ModeName, action: HistoryAction): void {
        this.stacks[mode].push(action);
    }

    public undo(): boolean {
        return this.stacks[this.activeMode].undo();
    }

    public redo(): boolean {
        return this.stacks[this.activeMode].redo();
    }

    public notifyActiveState(): void {
        const stack = this.stacks[this.activeMode];
        this.onStateChange(stack.canUndo, stack.canRedo);
    }
}
