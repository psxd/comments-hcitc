/* Keep full episode labels at the same 10 px dot offset as the E-002 scene. */
import * as THREE from "./vendor/three/three.module.js";

const previous = new WeakMap();

export function placeEpisodeScreenLabels({ camera, sceneHost, participants, markers, labels, earth, selected }) {
  camera.updateMatrixWorld(true);
  const width = sceneHost.clientWidth, height = sceneHost.clientHeight;
  const stage = sceneHost.getBoundingClientRect(), panel = document.getElementById("ui")?.getBoundingClientRect();
  const occupied = [], dots = {};
  const ordered = [participants[0], participants.find(item => item.slot === selected),
    ...participants.filter(item => item.slot !== "A" && item.slot !== selected)].filter(Boolean);
  for (const item of ordered) {
    const marker = markers[item.slot], label = labels[item.slot];
    if (!marker?.userData.available) { if (marker) marker.visible = false; if (label) label.hidden = true; continue; }
    const projected = marker.position.clone().project(camera);
    const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
    const ray = marker.position.clone().sub(camera.position), fromEarth = camera.position.clone().sub(earth.position);
    const fraction = THREE.MathUtils.clamp(-fromEarth.dot(ray) / (ray.lengthSq() || 1), 0, 1);
    const occluded = fromEarth.addScaledVector(ray, fraction).length() < 1 && fraction < .99;
    const visible = projected.z < 1 && x > 8 && x < width - 8 && y > 8 && y < height - 8 && !occluded;
    marker.visible = visible; label.hidden = !visible;
    if (visible) dots[item.slot] = { x, y };
  }
  for (const item of ordered) {
    const dot = dots[item.slot], label = labels[item.slot];
    if (!dot) continue;
    const labelWidth = label.offsetWidth || 90, labelHeight = label.offsetHeight || 12;
    const last = previous.get(label), candidates = [];
    for (const side of ["right", "left"]) for (const dy of [0, -18, 18, -36, 36]) {
      const left = side === "right" ? dot.x + 10 : dot.x - labelWidth - 10;
      const top = dot.y + dy - labelHeight / 2;
      const box = { left, right: left + labelWidth, top, bottom: top + labelHeight };
      let score = Math.abs(dy) * .15;
      if (last) { if (side !== last.side) score += 80; if (dy !== last.dy) score += 18; }
      if (box.left < 8 || box.right > width - 8 || box.top < 8 || box.bottom > height - 8) score += 1000;
      if (panel && box.left < panel.right - stage.left + 8 && box.right > panel.left - stage.left && box.bottom > panel.top - stage.top && box.top < panel.bottom - stage.top) score += 400;
      for (const other of occupied) if (box.left < other.right + 5 && box.right > other.left - 5 && box.top < other.bottom + 5 && box.bottom > other.top - 5) score += 200;
      for (const [slot, other] of Object.entries(dots)) if (slot !== item.slot && other.x > box.left - 8 && other.x < box.right + 8 && other.y > box.top - 7 && other.y < box.bottom + 7) score += 30;
      candidates.push({ side, dy, box, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates[0];
    label.style.left = `${chosen.box.left}px`;
    label.style.top = `${(chosen.box.top + chosen.box.bottom) / 2}px`;
    label.classList.toggle("is-muted", item.slot !== "A" && item.slot !== selected);
    previous.set(label, { side: chosen.side, dy: chosen.dy });
    occupied.push(chosen.box);
  }
}
