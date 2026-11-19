/* Polyhedron geometry, lighting, and ring drawing follow the ESPL SBI
   Geneva Briefings Carousel Animations/model-link.js reference. */
import * as THREE from "../visualization/Viz/vendor/three/three.module.js";

export function decorateModelLink(link) {
  if (!link.isConnected) return;
  const canvas = link.querySelector(".model-canvas");
  const action = link.querySelector(".model-action");
  if (!canvas) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0, 0, 4.3);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(58, 58, false);
    renderer.setClearColor(0x000000, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(1.35, 1.65, 2.4); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffe7a3, 0.2);
    fillLight.position.set(-1.35, -0.7, 1.35); scene.add(fillLight);
    const globe = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xf4ba20, emissive: 0xeaaa00,
        emissiveIntensity: 0.18, flatShading: true, roughness: 0.76, metalness: 0.08 })
    );
    globe.rotation.set(0.45, 0.65, 0); scene.add(globe);
    const orbitRoot = new THREE.Group();
    orbitRoot.rotation.set(THREE.MathUtils.degToRad(29), THREE.MathUtils.degToRad(15), THREE.MathUtils.degToRad(14));
    scene.add(orbitRoot);
    const segmentCount = 360, points = [], xAxis = new THREE.Vector3(1, 0, 0), yAxis = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index <= segmentCount; index += 1) {
      const angle = index / segmentCount * Math.PI * 2;
      const point = new THREE.Vector3(Math.cos(angle) * 1.12, Math.sin(angle) * 1.12, 0);
      point.applyAxisAngle(xAxis, THREE.MathUtils.degToRad(64));
      point.applyAxisAngle(yAxis, THREE.MathUtils.degToRad(22));
      points.push(point);
    }
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segmentCount, 0.024, 6, false);
    const orbit = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: false }));
    orbitRoot.add(orbit);
    const setOrbit = value => geometry.setDrawRange(0, Math.floor(segmentCount * Math.max(0, Math.min(1, value))) * 6 * 6);
    const render = () => renderer.render(scene, camera);
    setOrbit(1); render();
    canvas.classList.add("model-canvas-ready");
    if (canvas.previousElementSibling) canvas.previousElementSibling.hidden = true;
    let frame = 0, open = false, started = 0;
    const restingRotation = globe.rotation.y;
    const ease = t => t * t * (3 - 2 * t);
    const portion = (elapsed, start, duration) => ease(Math.max(0, Math.min(1, (elapsed - start) / duration)));
    function animate(now) {
      if (!open || !link.isConnected) return;
      const elapsed = now - started;
      link.dataset.modelStage = elapsed < 220 ? "enter" : elapsed < 440 ? "spin" : elapsed < 720 ? "orbit" : elapsed < 1070 ? "text" : "arrow";
      globe.rotation.y = restingRotation + 1.05 * portion(elapsed, 220, 220);
      // The complete orbit is visible before hover. Trace it out and back in.
      const orbitProgress = elapsed < 220 ? 1 - portion(elapsed, 0, 220) : portion(elapsed, 220, 500);
      setOrbit(orbitProgress);
      link.dataset.orbitProgress = orbitProgress.toFixed(2);
      render();
      if (elapsed < 1350) frame = requestAnimationFrame(animate);
    }
    function setOpen(value) {
      if (open === value) return;
      cancelAnimationFrame(frame);
      open = value; link.classList.toggle("is-open", value);
      globe.rotation.y = restingRotation; setOrbit(1); render();
      link.dataset.orbitProgress = "1.00";
      link.dataset.modelStage = value ? "enter" : "idle";
      if (!value) return;
      if (reducedMotion.matches) {
        globe.rotation.y = restingRotation + 1.05; setOrbit(1); render();
        link.dataset.orbitProgress = "1.00"; link.dataset.modelStage = "arrow";
        return;
      }
      started = performance.now(); frame = requestAnimationFrame(animate);
    }
    link.addEventListener("pointerenter", () => setOpen(true));
    link.addEventListener("pointerleave", () => { if (document.activeElement !== link) setOpen(false); });
    link.addEventListener("focus", () => setOpen(true));
    link.addEventListener("blur", () => { if (!link.matches(":hover")) setOpen(false); });
    action?.addEventListener("pointerenter", () => {
      if (link.dataset.modelStage !== "arrow" || reducedMotion.matches) return;
      link.classList.remove("is-action-hover");
      // Restart only the secondary arrow animation; the scene's staged entrance keeps its state.
      void action.offsetWidth;
      link.classList.add("is-action-hover");
    });
    action?.addEventListener("pointerleave", () => link.classList.remove("is-action-hover"));
    const observer = new MutationObserver(() => {
      if (link.isConnected) return;
      observer.disconnect(); cancelAnimationFrame(frame);
      geometry.dispose(); globe.geometry.dispose(); globe.material.dispose(); orbit.material.dispose(); renderer.dispose();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (error) {
    link.dataset.modelError = String(error?.message || error);
    canvas.remove();
    link.classList.add("model-static-fallback");
  }
}
