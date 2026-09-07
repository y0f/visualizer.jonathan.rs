precision mediump float;

varying float vBright;

void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float r = dot(c, c);
    float mask = smoothstep(0.25, 0.05, r);
    float g = vBright * mask;
    gl_FragColor = vec4(vec3(g), g);
}
