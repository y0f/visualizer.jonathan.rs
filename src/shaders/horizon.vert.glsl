attribute vec3 position;
attribute vec4 color;
attribute float size;
attribute float patern;
uniform vec2 mouse;
uniform vec2 resolution;
uniform float cursor_radius;
uniform float pixel_ratio;

varying vec4 vColor;
varying float vPatern;

void main(void) {
    vColor = color;
    vPatern = patern;

    vec2 p = position.xy * resolution;
    vec2 m = mouse * resolution;
    float s = (distance(p, m) < cursor_radius) ? size * 2.0 : size;

    gl_Position = vec4(position, 1.0);
    gl_PointSize = s * pixel_ratio;
}
