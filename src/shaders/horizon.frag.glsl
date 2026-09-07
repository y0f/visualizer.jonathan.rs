precision mediump float;
varying vec4 vColor;
varying float vPatern;
uniform sampler2D texture1;
uniform sampler2D texture2;

void main(void) {
    vec4 smpColor = vec4(1.0);
    smpColor = (vPatern == 0.0) ? texture2D(texture1, gl_PointCoord) : smpColor;
    smpColor = (vPatern == 1.0) ? texture2D(texture2, gl_PointCoord) : smpColor;

    gl_FragColor = (vPatern == 0.0 || vPatern == 1.0) ? vColor * smpColor : vColor;
}
