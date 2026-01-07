"use client";

import { useEffect, useRef, useState } from "react";

interface ThreeDPreviewProps {
  documentId: string;
}

export function ThreeDPreview({ documentId }: ThreeDPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sceneRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const animationIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;

    async function initScene() {
      try {
        // Dynamic import of Three.js
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");

        if (!mounted || !containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;
        const aspect = width / height;

        // Create scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a);
        sceneRef.current = scene;

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        scene.add(directionalLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
        backLight.position.set(-5, -5, -5);
        scene.add(backLight);

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        // Fetch model
        const response = await fetch(`/api/preview/model/${documentId}`);
        if (!response.ok) {
          throw new Error("Unable to load 3D model");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        // Load model
        const loader = new GLTFLoader();
        loader.load(
          url,
          (gltf) => {
            if (!mounted) return;

            const model = gltf.scene;
            scene.add(model);

            // Calculate bounding box
            const worldBox = new THREE.Box3().setFromObject(model);
            const worldCenter = worldBox.getCenter(new THREE.Vector3());
            const worldSize = worldBox.getSize(new THREE.Vector3());
            const halfSize = worldSize.clone().multiplyScalar(0.5);

            // Get bbox corners for projection
            const boxCorners = [
              new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y - halfSize.y, worldCenter.z - halfSize.z),
              new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y - halfSize.y, worldCenter.z + halfSize.z),
              new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y + halfSize.y, worldCenter.z - halfSize.z),
              new THREE.Vector3(worldCenter.x - halfSize.x, worldCenter.y + halfSize.y, worldCenter.z + halfSize.z),
              new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y - halfSize.y, worldCenter.z - halfSize.z),
              new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y - halfSize.y, worldCenter.z + halfSize.z),
              new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y + halfSize.y, worldCenter.z - halfSize.z),
              new THREE.Vector3(worldCenter.x + halfSize.x, worldCenter.y + halfSize.y, worldCenter.z + halfSize.z),
            ];

            // Perspective view: ~45° around Y, ~30° elevation
            const fov = 45;
            const viewDir = new THREE.Vector3(1, 0.6, 1).normalize();

            // Initial distance estimate
            const initialDistance = halfSize.length() * 3;

            // Create camera at initial position
            const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, initialDistance * 10);
            camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(initialDistance));
            camera.up.set(0, 1, 0);
            camera.lookAt(worldCenter);
            camera.updateMatrixWorld();
            camera.updateProjectionMatrix();

            // Project corners to NDC to find scale
            let minNdcX = Infinity, maxNdcX = -Infinity;
            let minNdcY = Infinity, maxNdcY = -Infinity;

            for (const point of boxCorners) {
              const projected = point.clone().project(camera);
              minNdcX = Math.min(minNdcX, projected.x);
              maxNdcX = Math.max(maxNdcX, projected.x);
              minNdcY = Math.min(minNdcY, projected.y);
              maxNdcY = Math.max(maxNdcY, projected.y);
            }

            const ndcWidth = maxNdcX - minNdcX;
            const ndcHeight = maxNdcY - minNdcY;

            // Scale to fit 90% of frame
            const targetSize = 1.8;
            const scaleFactor = targetSize / Math.max(ndcWidth, ndcHeight);
            const newDistance = initialDistance / scaleFactor;

            // Move camera to new distance
            camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(newDistance));
            camera.lookAt(worldCenter);
            camera.updateMatrixWorld();

            // Center using Thales theorem
            const viewMatrix = camera.matrixWorldInverse;
            let minTanX = Infinity, maxTanX = -Infinity;
            let minTanY = Infinity, maxTanY = -Infinity;

            for (const point of boxCorners) {
              const camSpacePoint = point.clone().applyMatrix4(viewMatrix);
              const depth = -camSpacePoint.z;
              if (depth > 0) {
                minTanX = Math.min(minTanX, camSpacePoint.x / depth);
                maxTanX = Math.max(maxTanX, camSpacePoint.x / depth);
                minTanY = Math.min(minTanY, camSpacePoint.y / depth);
                maxTanY = Math.max(maxTanY, camSpacePoint.y / depth);
              }
            }

            const tanCenterX = (minTanX + maxTanX) / 2;
            const tanCenterY = (minTanY + maxTanY) / 2;

            const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

            const offsetX = tanCenterX * newDistance;
            const offsetY = tanCenterY * newDistance;

            camera.position.add(camRight.clone().multiplyScalar(offsetX));
            camera.position.add(camUp.clone().multiplyScalar(offsetY));

            const newLookAt = worldCenter.clone()
              .add(camRight.clone().multiplyScalar(offsetX))
              .add(camUp.clone().multiplyScalar(offsetY));
            camera.lookAt(newLookAt);
            camera.updateProjectionMatrix();

            // Setup OrbitControls
            const controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.target.copy(newLookAt);
            controls.update();
            controlsRef.current = controls;

            URL.revokeObjectURL(url);
            setLoading(false);

            // Animation loop
            function animate() {
              animationIdRef.current = requestAnimationFrame(animate);
              controls.update();
              renderer.render(scene, camera);
            }
            animate();
          },
          undefined,
          (err) => {
            console.error("Error loading 3D model:", err);
            setError("Error loading 3D model");
            setLoading(false);
          }
        );
      } catch (err: any) {
        console.error("3D preview error:", err);
        setError(err.message || "Error initializing 3D viewer");
        setLoading(false);
      }
    }

    initScene();

    return () => {
      mounted = false;
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.domElement.remove();
      }
      sceneRef.current = null;
    };
  }, [documentId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-red-400 mb-4">{error}</p>
        <a
          href={`/api/preview/model/${documentId}?download=true`}
          className="text-[var(--primary)] hover:underline"
        >
          Download model
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--secondary)]">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full" />
            <p className="text-sm text-[var(--muted-foreground)]">Loading 3D model...</p>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-96 rounded-lg overflow-hidden bg-[#1a1a1a]"
      />
      {!loading && (
        <div className="flex justify-center gap-4 mt-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            Use mouse to rotate • Scroll to zoom
          </p>
          <a
            href={`/api/preview/model/${documentId}?download=true`}
            download
            className="text-xs text-[var(--primary)] hover:underline"
          >
            Download
          </a>
        </div>
      )}
    </div>
  );
}
