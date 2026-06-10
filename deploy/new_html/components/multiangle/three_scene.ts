/**
 * three_scene.ts - Three.js 场景初始化与渲染
 * 负责 3D 场景、材质、几何体、渲染循环、resize 处理
 */

import * as THREE from 'three';

export interface SceneConfig {
    container: HTMLElement;
    width?: number;
    height?: number;
    backgroundColor?: number;
}

export interface SceneState {
    azimuth: number;     // 水平角 (0-360)
    elevation: number;   // 俯仰角 (-30 to 90)
    distance: number;    // 相机距离 (对应 zoom 0-10)
}

export class ThreeScene {
    private container: HTMLElement;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private imagePlane: THREE.Mesh | null = null;
    private animationId: number | null = null;
    
    // 轨道指示器
    private azimuthRing: THREE.Line | null = null;
    private elevationArc: THREE.Line | null = null;
    private azimuthHandle: THREE.Mesh | null = null;
    private elevationHandle: THREE.Mesh | null = null;
    
    // 状态
    private _state: SceneState = {
        azimuth: 0,
        elevation: 0,
        distance: 5,
    };
    
    // 事件回调
    public onStateChange?: (state: SceneState) => void;
    
    constructor(config: SceneConfig) {
        this.container = config.container;
        
        const width = config.width || container.clientWidth || 400;
        const height = config.height || container.clientHeight || 300;
        
        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(config.backgroundColor || 0x1a1a2e);
        
        // 创建相机
        this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
        this.updateCameraPosition();
        
        // 创建渲染器
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true 
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);
        
        // 添加灯光
        this.setupLights();
        
        // 创建轨道指示器
        this.createOrbitIndicators();
        
        // 添加网格参考
        this.createGridHelper();
        
        // 开始渲染循环
        this.animate();
        
        // 监听 resize
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);
    }
    
    private setupLights(): void {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);
    }
    
    private createGridHelper(): void {
        const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        gridHelper.position.y = -1.5;
        this.scene.add(gridHelper);
    }
    
    private createOrbitIndicators(): void {
        // 水平旋转环 (粉色)
        const azimuthGeometry = new THREE.BufferGeometry();
        const azimuthPoints: THREE.Vector3[] = [];
        for (let i = 0; i <= 64; i++) {
            const angle = (i / 64) * Math.PI * 2;
            azimuthPoints.push(new THREE.Vector3(
                Math.cos(angle) * 3,
                0,
                Math.sin(angle) * 3
            ));
        }
        azimuthGeometry.setFromPoints(azimuthPoints);
        
        const azimuthMaterial = new THREE.LineBasicMaterial({ 
            color: 0xff69b4,  // 粉色
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });
        this.azimuthRing = new THREE.Line(azimuthGeometry, azimuthMaterial);
        this.scene.add(this.azimuthRing);
        
        // 水平角控制手柄
        const handleGeometry = new THREE.SphereGeometry(0.15, 16, 16);
        const handleMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff69b4,
            transparent: true,
            opacity: 0.9
        });
        this.azimuthHandle = new THREE.Mesh(handleGeometry, handleMaterial);
        this.updateAzimuthHandle();
        this.scene.add(this.azimuthHandle);
        
        // 俯仰角弧线 (青色)
        this.updateElevationArc();
        
        // 俯仰角控制手柄
        const elevationHandleMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ffff,  // 青色
            transparent: true,
            opacity: 0.9
        });
        this.elevationHandle = new THREE.Mesh(handleGeometry.clone(), elevationHandleMaterial);
        this.updateElevationHandle();
        this.scene.add(this.elevationHandle);
    }
    
    private updateElevationArc(): void {
        if (this.elevationArc) {
            this.scene.remove(this.elevationArc);
        }
        
        const arcGeometry = new THREE.BufferGeometry();
        const arcPoints: THREE.Vector3[] = [];
        
        // 从 -30° 到 90°
        for (let i = 0; i <= 32; i++) {
            const angle = (-30 + (i / 32) * 120) * (Math.PI / 180);
            const radius = 3;
            arcPoints.push(new THREE.Vector3(
                Math.cos(angle) * radius * Math.cos(this._state.azimuth * Math.PI / 180),
                Math.sin(angle) * radius,
                Math.cos(angle) * radius * Math.sin(this._state.azimuth * Math.PI / 180)
            ));
        }
        arcGeometry.setFromPoints(arcPoints);
        
        const arcMaterial = new THREE.LineBasicMaterial({ 
            color: 0x00ffff,  // 青色
            linewidth: 2,
            transparent: true,
            opacity: 0.8
        });
        this.elevationArc = new THREE.Line(arcGeometry, arcMaterial);
        this.scene.add(this.elevationArc);
    }
    
    private updateAzimuthHandle(): void {
        if (!this.azimuthHandle) return;
        const rad = this._state.azimuth * Math.PI / 180;
        this.azimuthHandle.position.set(
            Math.cos(rad) * 3,
            0,
            Math.sin(rad) * 3
        );
    }
    
    private updateElevationHandle(): void {
        if (!this.elevationHandle) return;
        const azimuthRad = this._state.azimuth * Math.PI / 180;
        const elevationRad = this._state.elevation * Math.PI / 180;
        const radius = 3;
        this.elevationHandle.position.set(
            Math.cos(elevationRad) * radius * Math.cos(azimuthRad),
            Math.sin(elevationRad) * radius,
            Math.cos(elevationRad) * radius * Math.sin(azimuthRad)
        );
    }
    
    private updateCameraPosition(): void {
        const azimuthRad = this._state.azimuth * Math.PI / 180;
        const elevationRad = this._state.elevation * Math.PI / 180;
        const distance = this.zoomToDistance(this._state.distance);
        
        this.camera.position.set(
            Math.cos(elevationRad) * distance * Math.cos(azimuthRad),
            Math.sin(elevationRad) * distance,
            Math.cos(elevationRad) * distance * Math.sin(azimuthRad)
        );
        this.camera.lookAt(0, 0, 0);
    }
    
    // 将 zoom 值 (0-10) 转换为相机距离
    private zoomToDistance(zoom: number): number {
        // zoom 0 = 很近 (距离 2), zoom 10 = 很远 (距离 10)
        return 2 + zoom * 0.8;
    }
    
    get state(): SceneState {
        return { ...this._state };
    }
    
    setState(newState: Partial<SceneState>): void {
        if (newState.azimuth !== undefined) {
            this._state.azimuth = ((newState.azimuth % 360) + 360) % 360;
        }
        if (newState.elevation !== undefined) {
            this._state.elevation = Math.max(-30, Math.min(90, newState.elevation));
        }
        if (newState.distance !== undefined) {
            this._state.distance = Math.max(0, Math.min(10, newState.distance));
        }
        
        this.updateCameraPosition();
        this.updateAzimuthHandle();
        this.updateElevationHandle();
        this.updateElevationArc();
        
        if (this.onStateChange) {
            this.onStateChange(this.state);
        }
    }
    
    setImage(imageUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                imageUrl,
                (texture) => {
                    // 移除旧的图片平面
                    if (this.imagePlane) {
                        this.scene.remove(this.imagePlane);
                        this.imagePlane.geometry.dispose();
                        (this.imagePlane.material as THREE.Material).dispose();
                    }
                    
                    // 计算宽高比
                    const aspect = texture.image.width / texture.image.height;
                    const height = 2;
                    const width = height * aspect;
                    
                    // 创建新的图片平面
                    const geometry = new THREE.PlaneGeometry(width, height);
                    const material = new THREE.MeshBasicMaterial({ 
                        map: texture,
                        side: THREE.DoubleSide
                    });
                    this.imagePlane = new THREE.Mesh(geometry, material);
                    this.scene.add(this.imagePlane);
                    
                    resolve();
                },
                undefined,
                (error) => {
                    console.error('Error loading texture:', error);
                    reject(error);
                }
            );
        });
    }
    
    // 获取控制手柄用于 raycaster
    getAzimuthHandle(): THREE.Mesh | null {
        return this.azimuthHandle;
    }
    
    getElevationHandle(): THREE.Mesh | null {
        return this.elevationHandle;
    }
    
    getCamera(): THREE.PerspectiveCamera {
        return this.camera;
    }
    
    getRenderer(): THREE.WebGLRenderer {
        return this.renderer;
    }
    
    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);
        this.renderer.render(this.scene, this.camera);
    };
    
    private handleResize(): void {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    dispose(): void {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        window.removeEventListener('resize', this.handleResize);
        
        // 清理 Three.js 资源
        this.renderer.dispose();
        this.container.removeChild(this.renderer.domElement);
        
        // 清理几何体和材质
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                if (Array.isArray(object.material)) {
                    object.material.forEach(m => m.dispose());
                } else {
                    object.material.dispose();
                }
            }
        });
    }
}

