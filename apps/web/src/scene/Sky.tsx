import { useMemo, useRef } from "react";

import { useFrame, useThree } from "@react-three/fiber";
import {
  BackSide,
  type Mesh,
  type Points,
  type ShaderMaterial,
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
} from "three";

import {
  HORIZON_COLOR,
  SKY_TRANSITION_END_M,
  SKY_TRANSITION_START_M,
  ZENITH_COLOR,
} from "./constants";

const SKY_RADIUS = 150_000;
const STAR_COUNT = 1500;
const STAR_RADIUS = 120_000;

const gradientVertex = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vWorldDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const gradientFragment = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uOpacity;
varying vec3 vWorldDir;
void main() {
  float t = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 1.4));
  gl_FragColor = vec4(col, uOpacity);
}
`;

function buildStarPositions(): Float32Array {
  const arr = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Uniform on a sphere, biased to upper hemisphere
    const u = Math.random();
    const v = Math.random() * 0.5 + 0.5; // upper hemisphere
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const x = STAR_RADIUS * Math.sin(phi) * Math.cos(theta);
    const y = STAR_RADIUS * Math.cos(phi);
    const z = STAR_RADIUS * Math.sin(phi) * Math.sin(theta);
    arr[i * 3 + 0] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = z;
  }
  return arr;
}

export function Sky() {
  const skyRef = useRef<Mesh>(null);
  const starsRef = useRef<Points>(null);
  const camera = useThree((s) => s.camera);

  const uniforms = useMemo(
    () => ({
      uHorizon: { value: new Color(HORIZON_COLOR) },
      uZenith: { value: new Color(ZENITH_COLOR) },
      uOpacity: { value: 1.0 },
    }),
    [],
  );

  const starGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(buildStarPositions(), 3));
    return g;
  }, []);

  useFrame(() => {
    const y = camera.position.y;
    const t =
      (y - SKY_TRANSITION_START_M) /
      (SKY_TRANSITION_END_M - SKY_TRANSITION_START_M);
    const blend = Math.min(1, Math.max(0, t));
    uniforms.uOpacity.value = 1 - blend;

    if (skyRef.current) {
      skyRef.current.position.copy(camera.position);
    }
    if (starsRef.current) {
      starsRef.current.position.copy(camera.position);
      const mat = starsRef.current.material as ShaderMaterial & {
        opacity: number;
      };
      mat.opacity = blend;
    }
  });

  return (
    <>
      <mesh ref={skyRef} frustumCulled={false}>
        <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={gradientVertex}
          fragmentShader={gradientFragment}
          side={BackSide}
          depthWrite={false}
          transparent
        />
      </mesh>
      <points
        ref={starsRef}
        geometry={starGeometry}
        frustumCulled={false}
      >
        <pointsMaterial
          size={2}
          sizeAttenuation={false}
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </>
  );
}
