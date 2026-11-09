import type * as THREE from 'three';
import { isolateMaterial } from './picking.js';
import type { HistoryAction } from '../history/historyManager.js';

export interface HiddenPartsDeps {
    /** Called whenever the set of hidden pieces changes (drives "Tout afficher"). */
    onChange(count: number): void;
    /** Pushes an undoable action to the history. */
    onAction(action: HistoryAction): void;
}

/** Length of the fade-out, so the user sees what disappeared. */
const FADE_MS = 250;

/** A material's state before the fade, restored once the mesh is hidden. */
type FadeBackup = { transparent: boolean; opacity: number };

interface Fade {
    elapsed: number;
    materials: THREE.Material[];
    from: number[];
    backup: FadeBackup[];
}

/**
 * HiddenParts: the pieces hidden by double tap.
 *
 * Hiding fades the piece out instead of popping it, then sets it invisible:
 * invisible meshes are skipped by the GPU pick pass, so what was behind
 * becomes selectable. The fade is advanced by {@link tick} from the render
 * loop, as window.requestAnimationFrame does not run in an immersive session.
 */
export class HiddenParts {
    private readonly deps: HiddenPartsDeps;
    private hidden: THREE.Mesh[] = [];
    private fades = new Map<THREE.Mesh, Fade>();

    constructor(deps: HiddenPartsDeps) {
        this.deps = deps;
    }

    public get count(): number {
        return this.hidden.length;
    }

    public get meshes(): readonly THREE.Mesh[] {
        return this.hidden;
    }

    /** Fades the meshes out and records one undoable step. */
    public hide(meshes: THREE.Mesh[]): void {
        const added = meshes.filter((mesh) => !this.hidden.includes(mesh));
        if (added.length === 0) return;

        for (const mesh of added) {
            this.hidden.push(mesh);
            this.startFade(mesh);
        }
        this.deps.onChange(this.hidden.length);

        this.deps.onAction({
            description: 'Masquer pièce',
            undo: () => {
                this.show(added);
            },
            redo: () => {
                this.rehide(added);
            },
        });
    }

    /** Reveals every hidden piece ("Tout afficher"), optionally as an undoable step. */
    public showAll(recordAction = false): void {
        if (this.hidden.length === 0) return;

        const previouslyHidden = [...this.hidden];
        this.show(previouslyHidden);

        if (recordAction) {
            this.deps.onAction({
                description: 'Afficher toutes les pièces',
                undo: () => {
                    this.rehide(previouslyHidden);
                },
                redo: () => {
                    this.show(previouslyHidden);
                },
            });
        }
    }

    /** Hides the meshes again at once, without fade or record (undoing a reset). */
    public rehide(meshes: readonly THREE.Mesh[]): void {
        for (const mesh of meshes) {
            if (this.hidden.includes(mesh)) continue;
            this.hidden.push(mesh);
            mesh.visible = false;
        }
        this.deps.onChange(this.hidden.length);
    }

    /** Advances the running fades; call once per rendered frame. */
    public tick(deltaMs: number): void {
        for (const [mesh, fade] of this.fades) {
            fade.elapsed += deltaMs;
            const t = Math.min(1, fade.elapsed / FADE_MS);
            fade.materials.forEach((material, i) => {
                material.opacity = fade.from[i] * (1 - t);
            });
            if (t >= 1) this.finishFade(mesh);
        }
    }

    private show(meshes: THREE.Mesh[]): void {
        for (const mesh of meshes) {
            this.finishFade(mesh);
            mesh.visible = true;
        }
        this.hidden = this.hidden.filter((mesh) => !meshes.includes(mesh));
        this.deps.onChange(this.hidden.length);
    }

    private startFade(mesh: THREE.Mesh): void {
        isolateMaterial(mesh);
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const backup = materials.map((material): FadeBackup => ({
            transparent: material.transparent,
            opacity: material.opacity,
        }));
        for (const material of materials) {
            material.transparent = true;
            material.needsUpdate = true;
        }
        this.fades.set(mesh, {
            elapsed: 0,
            materials,
            from: materials.map((material) => material.opacity),
            backup,
        });
    }

    /**
     * Ends a fade (completed, or cut short by an undo): the mesh goes
     * invisible and its materials get their state back, so it reappears as it
     * was. A mesh no longer in the hidden list (undone mid-fade) stays visible.
     */
    private finishFade(mesh: THREE.Mesh): void {
        const fade = this.fades.get(mesh);
        if (!fade) return;

        fade.materials.forEach((material, i) => {
            material.transparent = fade.backup[i].transparent;
            material.opacity = fade.backup[i].opacity;
            material.needsUpdate = true;
        });
        this.fades.delete(mesh);
        mesh.visible = !this.hidden.includes(mesh);
    }
}
