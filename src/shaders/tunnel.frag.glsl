uniform vec3 diffuse;
uniform vec3 emissive;
uniform sampler2D pointTexture;

#include <common>
#include <fog_pars_fragment>

void main() {
    vec4 tex = texture2D(pointTexture, gl_PointCoord);
    vec3 outgoingLight = diffuse + emissive;
    gl_FragColor = vec4(outgoingLight, tex.a) * tex;
    #include <fog_fragment>
}
