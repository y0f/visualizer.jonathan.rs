attribute vec2 position;
attribute float bright;
uniform float pixel_ratio;

varying float vBright;

void main() {
    vBright = bright;
    gl_Position = vec4(position, 0.0, 1.0);
    gl_PointSize = 3.0 * pixel_ratio;
}
