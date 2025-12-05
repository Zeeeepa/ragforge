/**
 * Perspective camera framing algorithm
 * This file is loaded by Playwright for testing
 *
 * Run with: npx tsx test-perspective-algo.ts
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function renderPerspective(width, height, modelUrl) {
  const aspect = width / height;
  const fov = 45;
  const fovRad = (fov * Math.PI) / 180;

  // Setup renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height);
  renderer.setClearColor(new THREE.Color('#333333'), 1);
  document.body.appendChild(renderer.domElement);

  // Setup scene
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);

  // Load model
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    loader.load(modelUrl, resolve, undefined, reject);
  });
  scene.add(gltf.scene);

  // Get bounding box
  const worldBox = new THREE.Box3().setFromObject(gltf.scene);
  const worldCenter = worldBox.getCenter(new THREE.Vector3());
  const worldSize = worldBox.getSize(new THREE.Vector3());
  const halfSize = worldSize.clone().multiplyScalar(0.5);

  console.log('World center:', worldCenter.x.toFixed(2), worldCenter.y.toFixed(2), worldCenter.z.toFixed(2));
  console.log('World size:', worldSize.x.toFixed(2), worldSize.y.toFixed(2), worldSize.z.toFixed(2));

  // Get all vertices for precise framing
  const allVertices = [];
  gltf.scene.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const posAttr = child.geometry.attributes.position;
      if (posAttr) {
        child.updateWorldMatrix(true, false);
        const worldMatrix = child.matrixWorld;
        for (let i = 0; i < posAttr.count; i++) {
          const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          v.applyMatrix4(worldMatrix);
          allVertices.push(v);
        }
      }
    }
  });
  console.log('Vertex count:', allVertices.length);

  // =====================================================
  // PERSPECTIVE CAMERA ALGORITHM - EDIT HERE
  // =====================================================

  const viewDir = new THREE.Vector3(1, 0.6, 1).normalize();
  const initialDistance = halfSize.length() * 3;

  // Create camera at initial position
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, initialDistance * 10);
  camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(initialDistance));
  camera.up.set(0, 1, 0);
  camera.lookAt(worldCenter);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  // Project points to NDC for distance calculation
  let minNdcX = Infinity, maxNdcX = -Infinity;
  let minNdcY = Infinity, maxNdcY = -Infinity;

  for (const point of allVertices) {
    const projected = point.clone().project(camera);
    minNdcX = Math.min(minNdcX, projected.x);
    maxNdcX = Math.max(maxNdcX, projected.x);
    minNdcY = Math.min(minNdcY, projected.y);
    maxNdcY = Math.max(maxNdcY, projected.y);
  }

  const ndcWidth = maxNdcX - minNdcX;
  const ndcHeight = maxNdcY - minNdcY;
  console.log('Initial NDC bounds:', minNdcX.toFixed(3), maxNdcX.toFixed(3), minNdcY.toFixed(3), maxNdcY.toFixed(3));
  console.log('Initial NDC size:', ndcWidth.toFixed(3), 'x', ndcHeight.toFixed(3));

  // Scale factor to fit in view (target: fill 90% of frame)
  const targetSize = 1.8;
  const scaleFactor = targetSize / Math.max(ndcWidth, ndcHeight);
  const newDistance = initialDistance / scaleFactor;

  console.log('Scale factor:', scaleFactor.toFixed(3), '-> new distance:', newDistance.toFixed(2));

  // Move camera to new distance
  camera.position.copy(worldCenter).add(viewDir.clone().multiplyScalar(newDistance));
  camera.lookAt(worldCenter);
  camera.updateMatrixWorld();

  // Compute tangent bounds for centering (Thales)
  const viewMatrix = camera.matrixWorldInverse;
  let minTanX = Infinity, maxTanX = -Infinity;
  let minTanY = Infinity, maxTanY = -Infinity;

  for (const point of allVertices) {
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
  console.log('Tangent center:', tanCenterX.toFixed(4), tanCenterY.toFixed(4));

  // Get camera axes
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

  // Translate camera to center the view
  const offsetX = tanCenterX * newDistance;
  const offsetY = tanCenterY * newDistance;
  console.log('World offset:', offsetX.toFixed(2), offsetY.toFixed(2));

  camera.position.add(camRight.clone().multiplyScalar(offsetX));
  camera.position.add(camUp.clone().multiplyScalar(offsetY));

  // Update lookAt to maintain same view direction
  const newLookAt = worldCenter.clone()
    .add(camRight.clone().multiplyScalar(offsetX))
    .add(camUp.clone().multiplyScalar(offsetY));
  camera.lookAt(newLookAt);

  camera.far = newDistance * 3;
  camera.updateProjectionMatrix();

  // =====================================================
  // END OF ALGORITHM
  // =====================================================

  // Render
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  gl.finish();
  await new Promise(resolve => setTimeout(resolve, 50));

  return renderer.domElement.toDataURL('image/png');
}
