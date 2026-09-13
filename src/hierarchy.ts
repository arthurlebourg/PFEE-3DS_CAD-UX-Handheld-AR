import * as THREE from 'three';

interface HierarchyNode {
    object: THREE.Object3D;
    rowElement: HTMLElement;
    visibilityBtn?: HTMLElement;
}

/**
 * HierarchyPanel: Displays the scene-graph of placed models in a collapsible
 * tree panel and synchronises with the PickHelper selection state.
 *
 * - Clicking a mesh row selects it (fires onSelect callback → PickHelper).
 * - Calling syncSelection() highlights the rows that match selected meshes.
 * - Calling refresh() rebuilds the tree from the current placed-models list.
 */
export class HierarchyPanel {
    private panel: HTMLDivElement;
    private nodes: HierarchyNode[] = [];
    private onSelect: (mesh: THREE.Mesh) => void;
    private onVisibilityChange: (mesh: THREE.Mesh, visible: boolean) => void;

    constructor(
        onSelect: (mesh: THREE.Mesh) => void,
        onVisibilityChange: (mesh: THREE.Mesh, visible: boolean) => void = () => {}
    ) {
        this.onSelect = onSelect;
        this.onVisibilityChange = onVisibilityChange;
        this.panel = document.createElement('div');
        this.panel.className = 'ar-hierarchy-panel';
        this.injectStyles();
    }

    public attach(parent: HTMLElement): void {
        parent.appendChild(this.panel);
        this.panel.addEventListener('beforexrselect', (e) => e.preventDefault());
    }

    public setVisible(visible: boolean): void {
        this.panel.classList.toggle('open', visible);
    }

    /**
     * Rebuilds the full tree from the current array of placed models.
     * Call this every time a model is added or removed.
     */
    public refresh(models: THREE.Object3D[]): void {
        this.panel.innerHTML = '';
        this.nodes = [];

        if (models.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'ar-hierarchy-empty';
            empty.textContent = 'Aucun objet placé';
            this.panel.appendChild(empty);
            return;
        }

        models.forEach((model, idx) => {
            const header = document.createElement('div');
            header.className = 'ar-hierarchy-model-header';
            header.textContent = `Objet ${idx + 1}`;
            this.panel.appendChild(header);

            const modelContainer = document.createElement('div');
            this.panel.appendChild(modelContainer);
            this.buildNode(model, 0, modelContainer);
        });
    }

    /**
     * Highlights in the panel the rows that correspond to selected meshes.
     * Call this whenever PickHelper.selectedMeshes changes.
     */
    public syncSelection(selectedMeshes: THREE.Mesh[]): void {
        const selectedSet = new Set<THREE.Object3D>(selectedMeshes);
        for (const node of this.nodes) {
            node.rowElement.classList.toggle('selected', selectedSet.has(node.object));
        }
    }

    /**
     * Refreshes the visibility icon for all mesh nodes to match their current
     * mesh.visible state. Call after any external visibility change.
     */
    public syncVisibility(): void {
        for (const node of this.nodes) {
            if (!(node.object instanceof THREE.Mesh) || !node.visibilityBtn) continue;
            const visible = node.object.visible;
            node.visibilityBtn.textContent = visible ? '◉' : '○';
            node.rowElement.classList.toggle('hidden-part', !visible);
        }
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    private buildNode(object: THREE.Object3D, depth: number, container: HTMLElement): void {
        const isMesh = object instanceof THREE.Mesh;
        const hasChildren = object.children.length > 0;
        const name = object.name.trim() || (isMesh ? 'Mesh' : 'Group');

        const wrapper = document.createElement('div');

        // Row
        const row = document.createElement('div');
        row.className = 'ar-hierarchy-row' + (isMesh ? ' mesh' : '');
        row.style.paddingLeft = `${6 + depth * 14}px`;

        // Expand/collapse toggle or spacer
        const toggleOrSpacer = document.createElement('span');
        if (hasChildren) {
            toggleOrSpacer.className = 'ar-hierarchy-toggle';
            toggleOrSpacer.textContent = '▾';
        } else {
            toggleOrSpacer.className = 'ar-hierarchy-spacer';
        }
        row.appendChild(toggleOrSpacer);

        // Icon
        const icon = document.createElement('span');
        icon.className = 'ar-hierarchy-icon';
        icon.textContent = isMesh ? '◈' : '⊞';
        row.appendChild(icon);

        // Label
        const label = document.createElement('span');
        label.className = 'ar-hierarchy-label';
        label.textContent = name;
        row.appendChild(label);

        wrapper.appendChild(row);

        // Visibility toggle button (meshes only)
        let visibilityBtn: HTMLElement | undefined;
        if (isMesh) {
            visibilityBtn = document.createElement('span');
            visibilityBtn.className = 'ar-hierarchy-visibility';
            visibilityBtn.textContent = object.visible ? '◉' : '○';
            visibilityBtn.title = 'Afficher / Masquer';
            row.appendChild(visibilityBtn);

            visibilityBtn.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mesh = object as THREE.Mesh;
                mesh.visible = !mesh.visible;
                visibilityBtn!.textContent = mesh.visible ? '◉' : '○';
                row.classList.toggle('hidden-part', !mesh.visible);
                this.onVisibilityChange(mesh, mesh.visible);
            });
        }

        // Click to select (meshes only)
        if (isMesh) {
            row.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.onSelect(object as THREE.Mesh);
            });
        }

        // Children
        if (hasChildren) {
            const childContainer = document.createElement('div');
            for (const child of object.children) {
                this.buildNode(child, depth + 1, childContainer);
            }
            wrapper.appendChild(childContainer);

            let expanded = true;
            toggleOrSpacer.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                expanded = !expanded;
                toggleOrSpacer.textContent = expanded ? '▾' : '▸';
                childContainer.style.display = expanded ? '' : 'none';
            });
        }

        this.nodes.push({ object, rowElement: row, visibilityBtn });
        container.appendChild(wrapper);
    }

    private injectStyles(): void {
        const styleId = 'ar-hierarchy-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .ar-hierarchy-panel {
                position: fixed;
                top: 50%;
                left: 12px;
                transform: translateY(-50%) translateX(calc(-100% - 12px));
                width: 200px;
                max-height: 60vh;
                overflow-y: auto;
                background: rgba(12, 12, 18, 0.88);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 14px;
                backdrop-filter: blur(14px);
                -webkit-backdrop-filter: blur(14px);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                z-index: 1050;
                padding: 10px 0;
                pointer-events: none;
                opacity: 0;
                transition: transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                            opacity 0.25s ease;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.75);
            }

            .ar-hierarchy-panel.open {
                transform: translateY(-50%) translateX(0);
                opacity: 1;
                pointer-events: auto;
            }

            .ar-hierarchy-panel::-webkit-scrollbar { width: 4px; }
            .ar-hierarchy-panel::-webkit-scrollbar-track { background: transparent; }
            .ar-hierarchy-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 2px; }

            .ar-hierarchy-model-header {
                padding: 5px 10px 3px;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: rgba(255, 255, 255, 0.35);
                border-top: 1px solid rgba(255,255,255,0.07);
                margin-top: 4px;
            }

            .ar-hierarchy-model-header:first-child {
                border-top: none;
                margin-top: 0;
            }

            .ar-hierarchy-row {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px 4px 6px;
                border-radius: 6px;
                margin: 1px 6px;
                cursor: default;
                transition: background 0.15s;
                white-space: nowrap;
                overflow: hidden;
            }

            .ar-hierarchy-row.mesh {
                cursor: pointer;
            }

            .ar-hierarchy-row.mesh:hover {
                background: rgba(255, 255, 255, 0.07);
            }

            .ar-hierarchy-row.selected {
                background: rgba(255, 102, 0, 0.25);
                border: 1px solid rgba(255, 102, 0, 0.5);
            }

            .ar-hierarchy-toggle,
            .ar-hierarchy-spacer {
                font-size: 9px;
                width: 12px;
                flex-shrink: 0;
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                user-select: none;
            }

            .ar-hierarchy-icon {
                font-size: 10px;
                flex-shrink: 0;
                color: rgba(255, 255, 255, 0.45);
            }

            .ar-hierarchy-row.mesh .ar-hierarchy-icon {
                color: rgba(255, 152, 50, 0.8);
            }

            .ar-hierarchy-label {
                overflow: hidden;
                text-overflow: ellipsis;
                flex: 1;
            }

            .ar-hierarchy-empty {
                text-align: center;
                padding: 16px 10px;
                color: rgba(255,255,255,0.3);
                font-size: 11px;
            }

            .ar-hierarchy-visibility {
                margin-left: auto;
                font-size: 10px;
                flex-shrink: 0;
                color: rgba(255, 255, 255, 0.45);
                cursor: pointer;
                user-select: none;
                padding: 0 2px;
                transition: color 0.15s;
            }

            .ar-hierarchy-visibility:hover {
                color: rgba(255, 255, 255, 0.9);
            }

            .ar-hierarchy-row.hidden-part {
                opacity: 0.4;
            }

            .ar-hierarchy-row.hidden-part .ar-hierarchy-label {
                text-decoration: line-through;
            }

            .ar-hierarchy-row.hidden-part .ar-hierarchy-visibility {
                color: rgba(255, 80, 80, 0.7);
            }
        `;
        document.head.appendChild(style);
    }
}
