import * as THREE from 'three';

/**
 * Occlusion: hides virtual content behind real-world surfaces using the WebXR
 * depth map (ARCore). Each frame the CPU depth buffer is uploaded to a texture
 * and a full-screen pass, drawn before everything else, writes it into the
 * depth buffer so the scene is depth-tested against reality.
 *
 * 'cpu-optimized' is deliberate: three.js only auto-handles 'gpu-optimized'
 * depth, and its built-in pass targets the Quest texture-array format, not
 * the phone one.
 */
export class Occlusion {
    public static readonly sessionInit: XRDepthStateInit = {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
    };

    private readonly renderer: THREE.WebGLRenderer;
    private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private texture: THREE.DataTexture | null = null;
    private meters = new Float32Array(0);

    constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
        this.renderer = renderer;
        const material = new THREE.ShaderMaterial({
            uniforms: {
                depthMap: { value: null },
                uvTransform: { value: new THREE.Matrix4() },
            },
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 1.0, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D depthMap;
                uniform mat4 uvTransform;
                uniform mat4 projectionMatrix;
                varying vec2 vUv;
                void main() {
                    // Normalized view coordinates have a top-left origin.
                    vec2 depthUv = (uvTransform * vec4(vUv.x, 1.0 - vUv.y, 0.0, 1.0)).xy;
                    float meters = texture2D(depthMap, depthUv).r;
                    if (meters <= 0.0) {
                        gl_FragDepth = 1.0;
                        return;
                    }
                    vec4 clip = projectionMatrix * vec4(0.0, 0.0, -meters, 1.0);
                    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
                }
            `,
            colorWrite: false,
            depthFunc: THREE.AlwaysDepth,
        });

        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -Infinity;
        this.mesh.visible = false;
        scene.add(this.mesh);
    }

    public update(frame?: XRFrame): void {
        this.mesh.visible = false;

        const session = this.renderer.xr.getSession();
        const referenceSpace = this.renderer.xr.getReferenceSpace();
        if (!frame || !referenceSpace || session?.depthUsage !== 'cpu-optimized') return;

        const view = frame.getViewerPose(referenceSpace)?.views[0];
        const depth = view && frame.getDepthInformation(view);
        if (!depth) return;

        if (!this.texture || this.texture.image.width !== depth.width || this.texture.image.height !== depth.height) {
            this.texture?.dispose();
            this.meters = new Float32Array(depth.width * depth.height);
            this.texture = new THREE.DataTexture(this.meters, depth.width, depth.height, THREE.RedFormat, THREE.FloatType);
            if (this.renderer.extensions.has('OES_texture_float_linear')) {
                this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
            }
            this.mesh.material.uniforms.depthMap.value = this.texture;
        }

        const raw = session.depthDataFormat === 'float32' ? new Float32Array(depth.data) : new Uint16Array(depth.data);
        for (let i = 0; i < this.meters.length; i++) {
            this.meters[i] = raw[i] * depth.rawValueToMeters;
        }
        this.texture.needsUpdate = true;
        (this.mesh.material.uniforms.uvTransform.value as THREE.Matrix4).fromArray(depth.normDepthBufferFromNormView.matrix);
        this.mesh.visible = true;
    }
}
