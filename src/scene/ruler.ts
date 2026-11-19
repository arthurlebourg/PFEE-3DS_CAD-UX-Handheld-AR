import * as THREE from 'three';

/** A ruler's ends, in real-world (reference-space) coordinates; null until placed. */
export interface RulerPoints {
    start: THREE.Vector3 | null;
    end: THREE.Vector3 | null;
}

/**
 * Sizes per metre of distance to the eye: each mesh is rescaled every frame
 * by how far it is, so the ruler keeps the same thickness on screen near and
 * far, like a drawn overlay (a fixed 3 mm line vanishes beyond a metre or two).
 */
const LINE_RADIUS = 0.002;
const END_RADIUS = 0.006;
const AIM_RADIUS = 0.004;
const LIVE_OPACITY = 0.6;
/** Drawn last and over everything: a length must stay readable across the part it spans. */
const RENDER_ORDER = 10;
/** Labels whose midpoint projects further out than this (NDC) are hidden. */
const LABEL_NDC_LIMIT = 1.5;

const UP = new THREE.Vector3(0, 1, 0);

/** Length as written on the label: always centimetres, one decimal. */
export function formatLength(metres: number): string {
    return `${(metres * 100).toFixed(1)} cm`;
}

/**
 * Ruler: one measurement, drawn in the real world.
 *
 * It hangs under the camera rig in reference-space coordinates, so it stays put
 * in the room while the scene is zoomed, turned or moved under it, and its
 * length is the apparent one. While aiming, a live segment runs from the first
 * end to the aimed point. The length is a DOM pill kept over the segment's
 * middle, so it stays crisp and upright whatever the distance.
 */
export class Ruler {
    private readonly group = new THREE.Group();
    private readonly startEnd: THREE.Mesh;
    private readonly endEnd: THREE.Mesh;
    private readonly aimDot: THREE.Mesh;
    private readonly line: THREE.Mesh;
    private readonly lineMaterial: THREE.MeshBasicMaterial;
    private readonly label = document.createElement('div');

    private points: RulerPoints = { start: null, end: null };
    private aim: THREE.Vector3 | null = null;
    private visible = true;

    constructor(rig: THREE.Object3D) {
        // Unit sizes, scaled every frame (see update).
        const dotGeometry = new THREE.SphereGeometry(1, 16, 12);
        const endMaterial = Ruler.overlayMaterial(1);
        this.startEnd = this.addMesh(dotGeometry, endMaterial);
        this.endEnd = this.addMesh(dotGeometry, endMaterial);
        this.aimDot = this.addMesh(dotGeometry, Ruler.overlayMaterial(LIVE_OPACITY));

        // Base at the origin, along +Y: scaled to the segment length.
        const lineGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
        lineGeometry.translate(0, 0.5, 0);
        this.lineMaterial = Ruler.overlayMaterial(1);
        this.line = this.addMesh(lineGeometry, this.lineMaterial);

        rig.add(this.group);

        this.label.className = 'ar-ruler-label';
        this.label.style.display = 'none';
        this.injectStyles();
    }

    /** Mounts the length label into the dom-overlay root. */
    public attach(parent: HTMLElement): void {
        parent.appendChild(this.label);
    }

    /** Hides the whole ruler, label included (outside the AR session). */
    public setVisible(visible: boolean): void {
        this.visible = visible;
        if (!visible) {
            this.group.visible = false;
            this.label.style.display = 'none';
        }
    }

    public getPoints(): RulerPoints {
        return { start: this.points.start?.clone() ?? null, end: this.points.end?.clone() ?? null };
    }

    public setPoints(points: RulerPoints): void {
        this.points = { start: points.start?.clone() ?? null, end: points.end?.clone() ?? null };
    }

    /** The real-world point under the crosshair, or null when not aiming. */
    public setAim(point: THREE.Vector3 | null): void {
        this.aim = point;
    }

    /** Per frame: lays out the meshes and moves the label over the segment. */
    public update(camera: THREE.Camera): void {
        if (!this.visible) return;
        this.group.visible = true;

        const { start, end } = this.points;
        const to = end ?? (start ? this.aim : null);

        // The eye in the ruler's (real-world) frame, to size the meshes.
        this.group.updateWorldMatrix(true, false);
        const eye = this.group.worldToLocal(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld));

        this.placeDot(this.startEnd, start, END_RADIUS, eye);
        this.placeDot(this.endEnd, end, END_RADIUS, eye);
        this.placeDot(this.aimDot, this.aim, AIM_RADIUS, eye);

        const length = start && to ? start.distanceTo(to) : 0;
        this.line.visible = length > 1e-6;
        if (start && to && this.line.visible) {
            const radius = LINE_RADIUS * eye.distanceTo(start.clone().add(to).multiplyScalar(0.5));
            this.line.position.copy(start);
            this.line.quaternion.setFromUnitVectors(UP, to.clone().sub(start).normalize());
            this.line.scale.set(radius, length, radius);
            this.lineMaterial.opacity = end ? 1 : LIVE_OPACITY;
        }

        if (!start || !to) {
            this.label.style.display = 'none';
            return;
        }
        this.placeLabel(start.clone().add(to).multiplyScalar(0.5), camera, formatLength(length), end === null);
    }

    private placeDot(dot: THREE.Mesh, at: THREE.Vector3 | null, radius: number, eye: THREE.Vector3): void {
        dot.visible = at !== null;
        if (!at) return;
        dot.position.copy(at);
        dot.scale.setScalar(radius * eye.distanceTo(at));
    }

    private placeLabel(midpoint: THREE.Vector3, camera: THREE.Camera, text: string, live: boolean): void {
        const world = this.group.localToWorld(midpoint);

        const inFront = world.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
        const ndc = world.project(camera);
        if (!inFront || Math.abs(ndc.x) > LABEL_NDC_LIMIT || Math.abs(ndc.y) > LABEL_NDC_LIMIT) {
            this.label.style.display = 'none';
            return;
        }

        this.label.style.display = 'block';
        this.label.style.left = `${String(((ndc.x + 1) / 2) * window.innerWidth)}px`;
        this.label.style.top = `${String(((1 - ndc.y) / 2) * window.innerHeight)}px`;
        this.label.classList.toggle('live', live);
        if (this.label.textContent !== text) {
            this.label.textContent = text;
        }
    }

    private addMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = RENDER_ORDER;
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
    }

    private static overlayMaterial(opacity: number): THREE.MeshBasicMaterial {
        return new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false,
        });
    }

    private injectStyles(): void {
        const id = 'ar-ruler-styles';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
            /* Just above the middle: centred on it, a short ruler and the crosshair would vanish under it. */
            .ar-ruler-label {
                position: absolute;
                transform: translate(-50%, calc(-100% - 8px));
                padding: 4px 10px;
                border-radius: 12px;
                background: #fff;
                color: #111;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 14px;
                font-weight: 700;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
                pointer-events: none;
                z-index: 900;
            }
            .ar-ruler-label.live { background: rgba(255, 255, 255, 0.85); }
        `;
        document.head.appendChild(style);
    }
}
