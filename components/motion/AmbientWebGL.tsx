"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function AmbientWebGL({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 2.4;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const geometry = new THREE.PlaneGeometry(3.4, 2.2, 64, 64);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uMouse;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float wave = sin(pos.x * 3.0 + uTime * 0.8) * 0.045;
          wave += cos(pos.y * 4.0 + uTime * 0.6) * 0.035;
          wave += sin(distance(uv, uMouse) * 8.0 - uTime) * 0.03;
          pos.z += wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uMouse;
        void main() {
          vec2 uv = vUv;
          float d = distance(uv, uMouse);
          vec3 orange = vec3(0.957, 0.475, 0.125);
          vec3 navy = vec3(0.03, 0.08, 0.14);
          vec3 deep = vec3(0.02, 0.05, 0.09);
          float band = 0.5 + 0.5 * sin(uv.x * 4.0 + uTime * 0.35);
          vec3 col = mix(deep, navy, uv.y);
          col = mix(col, orange, band * 0.28 + (1.0 - d) * 0.22);
          float alpha = 0.42 * smoothstep(1.15, 0.2, d) + 0.12;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const mouse = { x: 0.5, y: 0.5 };
    const target = new THREE.Vector2(0.5, 0.5);
    const onMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      mouse.x = (e.clientX - rect.left) / rect.width;
      mouse.y = 1 - (e.clientY - rect.top) / rect.height;
    };
    window.addEventListener("pointermove", onMove);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      material.uniforms.uTime.value = t;
      target.set(mouse.x, mouse.y);
      material.uniforms.uMouse.value.lerp(target, 0.08);
      mesh.rotation.z = Math.sin(t * 0.15) * 0.04;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={className}
      aria-hidden
      style={{ pointerEvents: "none" }}
    />
  );
}
