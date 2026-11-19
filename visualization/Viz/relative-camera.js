/* Shared E-001 relative camera framing for the full model and table preview. */
export function relativeCameraFrame(THREE, target, reference, aspect) {
  if (!reference) return { position: target.clone().addScaledVector(target.clone().normalize(), .15), target };
  const sourceTarget = new THREE.Vector3(...reference.target);
  const sourceOffset = new THREE.Vector3(...reference.position).sub(sourceTarget);
  const rotation = new THREE.Quaternion().setFromUnitVectors(sourceTarget.clone().normalize(), target.clone().normalize());
  sourceOffset.applyQuaternion(rotation);
  sourceOffset.multiplyScalar(Math.max(1, reference.aspect / aspect));
  return { position: target.clone().add(sourceOffset), target };
}

export function relativeFitDistance(THREE, { positions, target, offset, up, fov, aspect, reference, minDistance, maxDistance }) {
  const direction = offset.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, direction).normalize();
  const screenUp = new THREE.Vector3().crossVectors(direction, right).normalize();
  const halfTan = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const base = reference
    ? new THREE.Vector3(...reference.position).sub(new THREE.Vector3(...reference.target)).length() * Math.max(1, reference.aspect / aspect)
    : .15;
  const fit = Math.max(...positions.map(position => {
    const delta = position.clone().sub(target);
    const lateral = Math.abs(delta.dot(right)) / (halfTan * aspect * .72);
    const vertical = Math.abs(delta.dot(screenUp)) / (halfTan * .72);
    return delta.dot(direction) + Math.max(lateral, vertical);
  }));
  return THREE.MathUtils.clamp(Math.max(base, fit), minDistance, maxDistance);
}
