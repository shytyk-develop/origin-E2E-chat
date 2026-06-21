import * as THREE from 'three';

const FRAGMENT_SHADER = `
precision mediump float;
in vec2 fragCoord;

uniform float u_time;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform vec2 u_resolution;
uniform int u_reverse;
uniform float u_animation_speed;

out vec4 fragColor;

float PHI = 1.61803398874989484820459;

float random(vec2 xy) {
    return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x);
}

void main() {
    vec2 st = fragCoord.xy;
    st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
    st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));

    float opacity = step(0.0, st.x);
    opacity *= step(0.0, st.y);

    vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));

    float frequency = 5.0;
    float show_offset = random(st2);
    float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
    opacity *= u_opacities[int(rand * 10.0)];
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
    opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));

    vec3 color = u_colors[int(show_offset * 6.0)];

    vec2 center_grid = u_resolution / 2.0 / u_total_size;
    float dist_from_center = distance(center_grid, st2);
    float timing_offset_intro = dist_from_center * 0.01 + (random(st2) * 0.15);
    float max_grid_dist = distance(center_grid, vec2(0.0, 0.0));
    float timing_offset_outro = (max_grid_dist - dist_from_center) * 0.02 + (random(st2 + 42.0) * 0.2);

    float current_timing_offset;
    if (u_reverse == 1) {
        current_timing_offset = timing_offset_outro;
        opacity *= 1.0 - step(current_timing_offset, u_time * u_animation_speed);
        opacity *= clamp((step(current_timing_offset + 0.1, u_time * u_animation_speed)) * 1.25, 1.0, 1.25);
    } else {
        current_timing_offset = timing_offset_intro;
        opacity *= step(current_timing_offset, u_time * u_animation_speed);
        opacity *= clamp((1.0 - step(current_timing_offset + 0.1, u_time * u_animation_speed)) * 1.25, 1.0, 1.25);
    }

    fragColor = vec4(color, opacity);
    fragColor.rgb *= fragColor.a;
}
`;

const VERTEX_SHADER = `
precision mediump float;
uniform vec2 u_resolution;
out vec2 fragCoord;

void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    fragCoord = (position.xy + vec2(1.0)) * 0.5 * u_resolution;
    fragCoord.y = u_resolution.y - fragCoord.y;
}
`;

const DEFAULT_OPACITIES = [0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1];

function buildColorUniform(colors) {
    let colorsArray = [colors[0], colors[0], colors[0], colors[0], colors[0], colors[0]];
    if (colors.length === 2) {
        colorsArray = [colors[0], colors[0], colors[0], colors[1], colors[1], colors[1]];
    } else if (colors.length >= 3) {
        colorsArray = [colors[0], colors[0], colors[1], colors[1], colors[2], colors[2]];
    }
    return colorsArray.map((color) => new THREE.Vector3(color[0] / 255, color[1] / 255, color[2] / 255));
}

export function createLoginCanvas(host, {
    reverse = false,
    animationSpeed = 0.5,
    colors = [[255, 255, 255], [255, 255, 255]],
    opacities = DEFAULT_OPACITIES,
    totalSize = 20,
    dotSize = 6,
} = {}) {
    if (!host) return null;

    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.className = 'login-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
        u_time: { value: 0 },
        u_opacities: { value: opacities },
        u_colors: { value: buildColorUniform(colors) },
        u_total_size: { value: totalSize },
        u_dot_size: { value: dotSize },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_reverse: { value: reverse ? 1 : 0 },
        u_animation_speed: { value: animationSpeed },
    };

    const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms,
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
        depthWrite: false,
    });

    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    const clock = new THREE.Clock();
    let rafId = 0;
    let disposed = false;

    const resize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        uniforms.u_resolution.value.set(width * 2, height * 2);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const tick = () => {
        if (disposed) return;
        uniforms.u_time.value = clock.getElapsedTime();
        renderer.render(scene, camera);
        rafId = requestAnimationFrame(tick);
    };
    tick();

    return {
        destroy() {
            disposed = true;
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            material.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}

let introCanvas = null;
let reverseCanvas = null;

export function mountLoginBackground(pageLogin) {
    if (!pageLogin) return;

    const introHost = pageLogin.querySelector('#loginCanvasIntro');
    const reverseHost = pageLogin.querySelector('#loginCanvasReverse');

    destroyLoginBackground();

    if (introHost) {
        introHost.replaceChildren();
        introCanvas = createLoginCanvas(introHost, {
            reverse: false,
            animationSpeed: 0.5,
        });
    }

    if (reverseHost) {
        reverseHost.replaceChildren();
        reverseHost.classList.add('hidden');
    }
}

export function resetLoginBackground(pageLogin) {
    const introHost = pageLogin?.querySelector('#loginCanvasIntro');
    const reverseHost = pageLogin?.querySelector('#loginCanvasReverse');
    introHost?.classList.remove('hidden');
    reverseHost?.classList.add('hidden');
    mountLoginBackground(pageLogin);
}

export function destroyLoginBackground() {
    introCanvas?.destroy();
    reverseCanvas?.destroy();
    introCanvas = null;
    reverseCanvas = null;
}

export function playLoginSuccessReveal(pageLogin) {
    const introHost = pageLogin?.querySelector('#loginCanvasIntro');
    const reverseHost = pageLogin?.querySelector('#loginCanvasReverse');
    if (!introHost || !reverseHost) {
        return Promise.resolve();
    }

    reverseHost.classList.remove('hidden');
    reverseCanvas?.destroy();
    reverseHost.replaceChildren();
    reverseCanvas = createLoginCanvas(reverseHost, {
        reverse: true,
        animationSpeed: 0.65,
    });

    return new Promise((resolve) => {
        window.setTimeout(() => {
            introHost.classList.add('hidden');
            resolve();
        }, 50);
    }).then(() => new Promise((resolve) => {
        window.setTimeout(resolve, 1400);
    }));
}
