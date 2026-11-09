/**
 * Interface representing an undoable and redoable action.
 */
export interface HistoryAction {
    readonly description: string;
    undo(): void;
    redo(): void;
}

/**
 * The app's single undo/redo stack. One entry per finished gesture or button
 * action; selection changes alone are never recorded.
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
