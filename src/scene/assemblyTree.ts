import * as THREE from 'three';
import type { GLTFReference } from 'three/addons/loaders/GLTFLoader.js';

/**
 * One node's own assembly info, stored as plain JSON under `userData.assembly`
 * so that Object3D.clone() carries it to every placed copy. Nodes refer to
 * each other by `id`, stable across clones (uuids are not): resolve them with
 * {@link indexAssembly}, once per placed model.
 */
export interface AssemblyInfo {
    /** Stable within a model and its clones. */
    id: number;
    /** Nearest level strictly above; absent on the root. */
    parentId?: number;
    /** The node's own mesh is one piece (all of its primitives, not its descendants). */
    piece?: true;
    /** The node is a slider step covering its whole subtree. */
    level?: true;
    /** Pieces in the subtree: its own piece plus all descendants'. */
    pieces: number;
}

/** One granularity slider step, bottom (a piece) to top (the whole model). */
export interface AssemblyStep {
    /** The node the step selects from. */
    node: THREE.Object3D;
    /** 'piece': the node's own primitives only; 'subtree': every piece below it. */
    scope: 'piece' | 'subtree';
    /** Pieces the step selects. */
    pieces: number;
}

const KEY = 'assembly';

export function getAssemblyInfo(object: THREE.Object3D): AssemblyInfo | undefined {
    return object.userData[KEY] as AssemblyInfo | undefined;
}

/** Maps assembly ids to the nodes of one model (or clone). Build once per placed model. */
export function indexAssembly(root: THREE.Object3D): Map<number, THREE.Object3D> {
    const index = new Map<number, THREE.Object3D>();
    root.traverse((object) => {
        const info = getAssemblyInfo(object);
        if (info) index.set(info.id, object);
    });
    return index;
}

/**
 * Computes, once per loaded model, the steps the granularity slider climbs
 * through the CAD hierarchy, and annotates the existing nodes with them. The
 * scene graph itself is never touched (no reparenting, no merging): explode,
 * Reset, picking and the grounding pivot keep working on the graph as loaded.
 *
 * - Piece: a glTF node's mesh. A multi-primitive mesh, which GLTFLoader splits
 *   into several THREE.Mesh under one Group, counts once; `associations` (the
 *   parser's map, only available at load) tells those primitives apart.
 *   Without it every Mesh counts.
 * - An InstancedMesh counts as ONE piece: picking resolves a whole mesh by its
 *   id colour and cannot single out an instance (see picking.ts:59-95,
 *   PickHelper.registerModel). None of the bundled models use instancing.
 * - Level: every node that changes the selection, i.e. groups ≥ 2 pieces and
 *   more than the node below it. A chain of nodes covering the same pieces
 *   (transform-only wrappers, single-child chains) would add a step that
 *   changes nothing on screen, so it is one level, carried by its top node;
 *   the root carries its own chain, so the gltf.scene pivot is the whole-model
 *   level, never one more step. Node names play no part.
 *
 * O(n): a post-order pass for counts, then two pre-order passes.
 */
export function buildAssemblyTree(root: THREE.Object3D, associations?: Map<unknown, GLTFReference>): void {
    const isPrimitive = (object: THREE.Object3D): boolean => {
        if (!associations || !(object instanceof THREE.Mesh)) return false;
        const ref = associations.get(object);
        return ref?.meshes !== undefined && ref.nodes === undefined;
    };

    const pieces = new Map<THREE.Object3D, number>();
    const ownPieces = new Set<THREE.Object3D>();
    const levels = new Set<THREE.Object3D>();

    // 1. Pieces per subtree.
    const count = (node: THREE.Object3D): number => {
        let ownPiece = node instanceof THREE.Mesh && !isPrimitive(node);
        let total = 0;
        for (const child of node.children) {
            if (isPrimitive(child)) {
                ownPiece = true;
                continue;
            }
            total += count(child);
        }
        if (ownPiece) {
            ownPieces.add(node);
            total += 1;
        }
        pieces.set(node, total);
        return total;
    };
    count(root);

    // 2. Levels: one per chain of nodes covering the same pieces, carried by
    // the chain's top node (`top`, or `node` when it starts the chain).
    const markLevels = (node: THREE.Object3D, top: THREE.Object3D): void => {
        const carriers = node.children.filter((child) => (pieces.get(child) ?? 0) > 0);
        const passesThrough =
            !ownPieces.has(node) && carriers.length === 1 && pieces.get(carriers[0]) === pieces.get(node);
        if (passesThrough) {
            markLevels(carriers[0], top);
            return;
        }
        if (top === root || pieces.get(node)! >= 2) {
            levels.add(top);
        }
        for (const child of carriers) {
            markLevels(child, child);
        }
    };
    markLevels(root, root);

    // 3. Write each kept node's own info.
    let nextId = 0;
    const write = (node: THREE.Object3D, parent: AssemblyInfo | undefined): void => {
        if (!pieces.has(node)) return; // a primitive: part of its node's piece

        const isLevel = levels.has(node);
        let info: AssemblyInfo | undefined;
        if (isLevel || ownPieces.has(node)) {
            info = { id: nextId++, pieces: pieces.get(node)! };
            if (parent) info.parentId = parent.id;
            if (isLevel) info.level = true;
            if (ownPieces.has(node)) info.piece = true;
            node.userData[KEY] = info;
        } else {
            delete node.userData[KEY];
        }

        const childParent = isLevel ? info : parent;
        for (const child of node.children) {
            write(child, childParent);
        }
    };
    write(root, undefined);
}

/** The piece a picked mesh belongs to: the mesh itself, or for a primitive its node. */
export function pieceOf(mesh: THREE.Mesh): THREE.Object3D | null {
    if (getAssemblyInfo(mesh)?.piece) return mesh;
    const parent = mesh.parent;
    return parent && getAssemblyInfo(parent)?.piece ? parent : null;
}

/**
 * A piece's own meshes: the node itself when it is a Mesh, else its primitives
 * (the info-less Mesh children). Never the pieces of its descendants.
 */
export function pieceMeshes(node: THREE.Object3D): THREE.Mesh[] {
    if (node instanceof THREE.Mesh) return [node as THREE.Mesh];
    const meshes: THREE.Mesh[] = [];
    for (const child of node.children) {
        if (child instanceof THREE.Mesh && !getAssemblyInfo(child)) meshes.push(child as THREE.Mesh);
    }
    return meshes;
}

/** Every mesh a step selects. Hidden pieces included, as before. */
export function stepMeshes(step: AssemblyStep): THREE.Mesh[] {
    if (step.scope === 'piece') return pieceMeshes(step.node);
    const meshes: THREE.Mesh[] = [];
    step.node.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child as THREE.Mesh);
    });
    return meshes;
}

/**
 * The steps above a picked mesh: its piece, the piece's node again as a
 * subtree when it also is a level, then each level up `parentId` to the root.
 * A level holding a single piece (the root of a one-piece model) would repeat
 * the piece and is skipped. `index` comes from {@link indexAssembly}.
 */
export function assemblySteps(mesh: THREE.Mesh, index: Map<number, THREE.Object3D>): AssemblyStep[] {
    const piece = pieceOf(mesh);
    const info = piece && getAssemblyInfo(piece);
    if (!piece || !info) return [];

    const steps: AssemblyStep[] = [{ node: piece, scope: 'piece', pieces: 1 }];
    if (info.level && info.pieces >= 2) {
        steps.push({ node: piece, scope: 'subtree', pieces: info.pieces });
    }
    let parentId = info.parentId;
    while (parentId !== undefined) {
        const node = index.get(parentId);
        const nodeInfo = node && getAssemblyInfo(node);
        if (!node || !nodeInfo) break;
        if (nodeInfo.pieces >= 2) {
            steps.push({ node, scope: 'subtree', pieces: nodeInfo.pieces });
        }
        parentId = nodeInfo.parentId;
    }
    return steps;
}
