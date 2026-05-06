import * as PIXI from "pixi.js";
import { Position, ParticleState, PARTICLE_COLORS } from "./ECS";

/**
 * BRUTAL INSTANCED PARTICLE RENDERER (PixiJS 8 Optimized)
 * High-performance instancing that stays within Pixi's render pipeline.
 */
export class InstancedParticleRenderer {
    private mesh: PIXI.Mesh<PIXI.Geometry, PIXI.Shader>;
    private geometry: PIXI.Geometry;
    
    private posData: Float32Array;
    private alphaData: Float32Array;
    private colorData: Float32Array;
    
    private colorLUT: number[][];

    constructor(maxParticles: number) {
        this.posData = new Float32Array(maxParticles * 2);
        this.alphaData = new Float32Array(maxParticles);
        this.colorData = new Float32Array(maxParticles * 3);

        this.colorLUT = PARTICLE_COLORS.map(hex => {
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            return [r, g, b];
        });

        this.geometry = new PIXI.Geometry({
            attributes: {
                aVertex: { buffer: new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), size: 2 },
                // Instance attributes
                aPos: { buffer: this.posData, size: 2, instance: true },
                aAlpha: { buffer: this.alphaData, size: 1, instance: true },
                aColor: { buffer: this.colorData, size: 3, instance: true },
            },
            indexBuffer: new Uint32Array([0, 1, 2, 1, 3, 2]),
        });

        const shader = PIXI.Shader.from({
            gl: {
                vertex: `
                    attribute vec2 aVertex;
                    attribute vec2 aPos;
                    attribute float aAlpha;
                    attribute vec3 aColor;

                    varying float vAlpha;
                    varying vec3 vColor;

                    uniform mat3 projectionMatrix;
                    uniform mat3 worldTransformMatrix;

                    void main() {
                        vAlpha = aAlpha;
                        vColor = aColor;
                        vec3 pos = worldTransformMatrix * vec3(aPos + aVertex * 4.0, 1.0);
                        gl_Position = vec4((projectionMatrix * pos).xy, 0.0, 1.0);
                    }
                `,
                fragment: `
                    varying float vAlpha;
                    varying vec3 vColor;
                    void main() {
                        gl_FragColor = vec4(vColor, vAlpha);
                    }
                `
            },
            gpu: {
                vertex: {
                    entryPoint: 'main',
                    source: `
                        struct GlobalUniforms {
                            projectionMatrix: mat3x3<f32>,
                            worldTransformMatrix: mat3x3<f32>,
                        };
                        @group(0) @binding(0) var<uniform> global: GlobalUniforms;

                        struct VSInput {
                            @location(0) aVertex: vec2<f32>,
                            @location(1) aPos: vec2<f32>,
                            @location(2) aAlpha: f32,
                            @location(3) aColor: vec3<f32>,
                        };

                        struct VSOutput {
                            @builtin(position) position: vec4<f32>,
                            @location(0) vAlpha: f32,
                            @location(1) vColor: vec3<f32>,
                        };

                        @vertex
                        fn main(input: VSInput) -> VSOutput {
                            var output: VSOutput;
                            output.vAlpha = input.aAlpha;
                            output.vColor = input.aColor;
                            let pos = global.worldTransformMatrix * vec3<f32>(input.aPos + input.aVertex * 4.0, 1.0);
                            output.position = vec4<f32>((global.projectionMatrix * pos).xy, 0.0, 1.0);
                            return output;
                        }
                    `
                },
                fragment: {
                    entryPoint: 'main',
                    source: `
                        @fragment
                        fn main(@location(0) vAlpha: f32, @location(1) vColor: vec3<f32>) -> @location(0) vec4<f32> {
                            return vec4<f32>(vColor, vAlpha);
                        }
                    `
                }
            }
        });

        this.mesh = new PIXI.Mesh({
            geometry: this.geometry,
            shader: shader,
        });
    }

    public get displayObject(): PIXI.Mesh<PIXI.Geometry, PIXI.Shader> {
        return this.mesh;
    }

    public update(ents: ArrayLike<number>) {
        const count = ents.length;
        
        for (let i = 0; i < count; i++) {
            // Buffer safety: don't exceed the allocated size of the renderer
            if (i >= this.alphaData.length) break;

            const eid = ents[i];
            const i2 = i * 2;
            const i3 = i * 3;
            
            this.posData[i2] = Position.x[eid];
            this.posData[i2 + 1] = Position.y[eid];
            
            this.alphaData[i] = ParticleState.life[eid] / ParticleState.maxLife[eid];
            
            // Safety: Fallback to first color if ID is invalid or undefined
            const colorId = ParticleState.colorId[eid];
            const color = this.colorLUT[colorId] || this.colorLUT[0];
            
            this.colorData[i3] = color[0];
            this.colorData[i3 + 1] = color[1];
            this.colorData[i3 + 2] = color[2];
        }

        // Mark attributes as dirty for GPU upload
        this.geometry.getBuffer('aPos').update();
        this.geometry.getBuffer('aAlpha').update();
        this.geometry.getBuffer('aColor').update();
        
        // Update instance count
        this.mesh.geometry.instanceCount = count;
    }
}
