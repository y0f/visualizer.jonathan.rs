attribute float size;
uniform float uPixelRatio;

#include <fog_pars_vertex>

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z) * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}
