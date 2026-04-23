function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpHexColor(THREE, a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

const SKY_KEYFRAMES = [
  { h: 0, top: '#07122d', horizon: '#1b2a52', bottom: '#05070f', stars: 1.0 },
  { h: 6, top: '#5a80c8', horizon: '#f39c69', bottom: '#5b3a3a', stars: 0.2 },
  { h: 11, top: '#79bfff', horizon: '#d7ecff', bottom: '#9fc4e4', stars: 0.0 },
  { h: 16, top: '#6ea6f2', horizon: '#ffd3a2', bottom: '#9f7267', stars: 0.0 },
  { h: 19, top: '#2a437a', horizon: '#d47d8c', bottom: '#382634', stars: 0.4 },
  { h: 24, top: '#07122d', horizon: '#1b2a52', bottom: '#05070f', stars: 1.0 },
];

function sampleSkyPalette(THREE, hours) {
  const h = ((Number(hours) % 24) + 24) % 24;
  let a = SKY_KEYFRAMES[0];
  let b = SKY_KEYFRAMES[1];
  for (let i = 1; i < SKY_KEYFRAMES.length; i++) {
    if (h <= SKY_KEYFRAMES[i].h) {
      a = SKY_KEYFRAMES[i - 1];
      b = SKY_KEYFRAMES[i];
      break;
    }
  }
  const range = Math.max(0.0001, b.h - a.h);
  const t = smooth01((h - a.h) / range);
  return {
    top: lerpHexColor(THREE, a.top, b.top, t),
    horizon: lerpHexColor(THREE, a.horizon, b.horizon, t),
    bottom: lerpHexColor(THREE, a.bottom, b.bottom, t),
    stars: lerp(a.stars, b.stars, t),
  };
}

export function createProceduralSkySystem({ THREE, scene, camera }) {
  const uniforms = {
    uTopColor: { value: new THREE.Color('#79bfff') },
    uHorizonColor: { value: new THREE.Color('#d7ecff') },
    uBottomColor: { value: new THREE.Color('#9fc4e4') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uStarsIntensity: { value: 0.0 },
    uTime: { value: 0.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uBottomColor;
      uniform vec3 uSunDir;
      uniform float uStarsIntensity;
      uniform float uTime;

      float hash31(vec3 p) {
        p = fract(p * vec3(0.1031, 0.11369, 0.13787));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        vec3 dir = normalize(vWorldPos - cameraPosition);
        float h01 = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

        vec3 skyA = mix(uBottomColor, uHorizonColor, smoothstep(0.00, 0.38, h01));
        vec3 skyB = mix(uHorizonColor, uTopColor, smoothstep(0.32, 1.00, h01));
        vec3 base = mix(skyA, skyB, smoothstep(0.22, 0.82, h01));

        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float sunCore = pow(sunDot, 900.0);
        float sunHalo = pow(sunDot, 16.0) * 0.42;
        vec3 sunTint = vec3(1.0, 0.82, 0.58);
        base += sunTint * (sunCore * 2.0 + sunHalo);

        vec3 moonDir = -normalize(uSunDir);
        float moonDot = max(dot(dir, moonDir), 0.0);
        float moonCore = pow(moonDot, 700.0) * (0.16 + uStarsIntensity * 0.55);
        float moonHalo = pow(moonDot, 14.0) * (0.08 + uStarsIntensity * 0.18);
        base += vec3(0.62, 0.75, 1.0) * (moonCore + moonHalo);

        float starMaskH = 1.0 - smoothstep(-0.10, 0.28, dir.y);
        vec3 starCell = floor(normalize(dir) * 410.0);
        float n = hash31(starCell);
        float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + n * 33.0);
        float star = step(0.9967, n) * twinkle * uStarsIntensity * starMaskH;
        base += vec3(0.9, 0.95, 1.0) * star;

        gl_FragColor = vec4(base, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1300, 40, 22), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  scene.add(mesh);

  function update(hours, sunPosition) {
    const palette = sampleSkyPalette(THREE, hours);
    uniforms.uTopColor.value.copy(palette.top);
    uniforms.uHorizonColor.value.copy(palette.horizon);
    uniforms.uBottomColor.value.copy(palette.bottom);
    uniforms.uStarsIntensity.value = palette.stars;
    if (sunPosition) uniforms.uSunDir.value.copy(sunPosition).normalize();
    scene.fog.color.copy(palette.horizon);
  }

  function tick(timeSec) {
    mesh.position.copy(camera.position);
    uniforms.uTime.value = timeSec;
  }

  return { update, tick };
}
