/* REYZ light field — rendering only. Scroll, words and copy remain in site.js.
   A pair of GPU draws creates fine light fibres and their restrained highlights.
   No external assets, timers, layout reads or input handling live in this layer. */
(() => {
  'use strict';
  const PINK = [247 / 255, 21 / 255, 172 / 255];
  const POINT_STRIDE = 7, RIBBON_STRIDE = 5;
  const TRIANGLE_CORNERS = [0, 1, 2, 2, 1, 3];

  function create(initialCanvas) {
    let canvas = initialCanvas, gl = null, ctx = null, mode = 'none';
    let width = 1, height = 1, ratio = 1, capacity = 0;
    let points = new Float32Array(0), ribbons = new Float32Array(0);
    let pointBuffer = null, ribbonBuffer = null, pointProgram = null, ribbonProgram = null;
    let lastFrame = null, fallbackReason = '', sprites = null;
    let lostHandler = null, resources = [], enabledAttributes = [], drawConfirmed = false;

    function replaceCanvas() {
      const replacement = canvas.cloneNode(false);
      canvas.replaceWith(replacement);
      canvas = replacement;
    }
    function releaseGPU() {
      if (lostHandler) canvas.removeEventListener('webglcontextlost', lostHandler);
      lostHandler = null;
      if (gl && !gl.isContextLost()) {
        for (const [kind, object] of resources) {
          if (kind === 'program') gl.deleteProgram(object);
          else if (kind === 'shader') gl.deleteShader(object);
          else gl.deleteBuffer(object);
        }
      }
      resources = []; enabledAttributes = [];
      pointBuffer = ribbonBuffer = pointProgram = ribbonProgram = null;
      gl = null;
    }
    function fallback(reason) {
      const hadGPU = !!gl;
      releaseGPU();
      if (hadGPU) replaceCanvas(); // A canvas cannot change from WebGL to 2D.
      try { ctx = canvas.getContext('2d', { alpha: true }); } catch { ctx = null; }
      if (!ctx && !hadGPU) {
        replaceCanvas();
        try { ctx = canvas.getContext('2d', { alpha: true }); } catch { ctx = null; }
      }
      mode = ctx ? 'canvas2d' : 'none';
      fallbackReason = reason;
      canvas.dataset.fieldRenderer = mode;
      resize(width, height, ratio);
    }
    function compile(type, source) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('shader-allocation');
      resources.push(['shader', shader]);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader-compile');
      return shader;
    }
    function program(vertex, fragment, attributes, uniforms, modern) {
      const prefix = modern ? '#version 300 es\n' : '';
      const replace = (source, fragmentStage) => source
        .replace(/ATTRIBUTE/g, modern ? 'in' : 'attribute')
        .replace(/VARYING/g, modern ? (fragmentStage ? 'in' : 'out') : 'varying')
        .replace(/OUTPUT_DECL/g, modern ? 'out vec4 fragColor;' : '')
        .replace(/OUTPUT_COLOR/g, modern ? 'fragColor' : 'gl_FragColor');
      const object = gl.createProgram();
      if (!object) throw new Error('program-allocation');
      resources.push(['program', object]);
      gl.attachShader(object, compile(gl.VERTEX_SHADER, prefix + replace(vertex, false)));
      gl.attachShader(object, compile(gl.FRAGMENT_SHADER, prefix + replace(fragment, true)));
      gl.linkProgram(object);
      if (!gl.getProgramParameter(object, gl.LINK_STATUS)) throw new Error('program-link');
      return {
        object,
        attributes: attributes.map(name => gl.getAttribLocation(object, name)),
        uniforms: Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(object, name)])),
      };
    }
    function setupGPU() {
      const options = { alpha: true, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' };
      let modern = true;
      try { gl = canvas.getContext('webgl2', options); } catch { gl = null; }
      if (!gl) { modern = false; try { gl = canvas.getContext('webgl', options); } catch { gl = null; } }
      if (!gl) { fallback('webgl-unavailable'); return; }
      try {
        pointProgram = program([
          'precision highp float;',
          'ATTRIBUTE vec2 a_position; ATTRIBUTE vec2 a_light; ATTRIBUTE vec3 a_surface;',
          'uniform vec2 u_resolution; uniform float u_ratio;',
          'VARYING mediump float v_alpha; VARYING mediump vec3 v_surface;',
          'void main(){',
          ' gl_Position=vec4(a_position.x/u_resolution.x*2.0-1.0,1.0-a_position.y/u_resolution.y*2.0,0.0,1.0);',
          ' gl_PointSize=a_light.x*u_ratio; v_alpha=a_light.y; v_surface=a_surface;',
          '}',
        ].join('\n'), [
          'precision mediump float;',
          'VARYING mediump float v_alpha; VARYING mediump vec3 v_surface; uniform float u_time; uniform vec3 u_pink;',
          'OUTPUT_DECL',
          'void main(){',
          ' vec2 p=gl_PointCoord*2.0-1.0; float c=cos(v_surface.x),s=sin(v_surface.x);',
          ' p=vec2(c*p.x-s*p.y,s*p.x+c*p.y);',
          ' vec2 lens=p*vec2(1.25,3.6); float d=dot(lens,lens);',
          ' float halo=exp(-d*1.9); float core=exp(-d*9.5);',
          ' float sheen=0.82+0.18*sin(v_surface.y+u_time*0.34);',
          ' float alpha=v_alpha*(halo*0.36+core*0.84)*(0.83+0.17*v_surface.z);',
          ' if(alpha<0.004)discard;',
          ' vec3 color=mix(u_pink,vec3(1.0,0.76,0.91),core*sheen*0.46);',
          ' OUTPUT_COLOR=vec4(color*alpha,alpha);',
          '}',
        ].join('\n'), ['a_position', 'a_light', 'a_surface'], ['u_resolution', 'u_ratio', 'u_time', 'u_pink'], modern);
        ribbonProgram = program([
          'precision highp float;',
          'ATTRIBUTE vec2 a_position; ATTRIBUTE vec3 a_light;',
          'uniform vec2 u_resolution; VARYING mediump vec3 v_light;',
          'void main(){',
          ' gl_Position=vec4(a_position.x/u_resolution.x*2.0-1.0,1.0-a_position.y/u_resolution.y*2.0,0.0,1.0);',
          ' v_light=a_light;',
          '}',
        ].join('\n'), [
          'precision mediump float; VARYING mediump vec3 v_light; uniform vec3 u_pink; uniform float u_time;',
          'OUTPUT_DECL',
          'void main(){',
          ' float edge=1.0-smoothstep(0.12,1.0,abs(v_light.x));',
          ' float sheen=0.78+0.22*sin(v_light.z+u_time*0.28);',
          ' float alpha=edge*v_light.y*sheen;',
          ' vec3 color=mix(u_pink,vec3(1.0,0.58,0.86),0.16*edge);',
          ' OUTPUT_COLOR=vec4(color*alpha,alpha);',
          '}',
        ].join('\n'), ['a_position', 'a_light'], ['u_resolution', 'u_time', 'u_pink'], modern);
        pointBuffer = gl.createBuffer(); ribbonBuffer = gl.createBuffer();
        if (!pointBuffer || !ribbonBuffer) throw new Error('buffer-allocation');
        resources.push(['buffer', pointBuffer], ['buffer', ribbonBuffer]);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.clearColor(0, 0, 0, 0);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('webgl-initialization');
        mode = modern ? 'webgl2' : 'webgl';
        canvas.dataset.fieldRenderer = mode;
        lostHandler = event => {
          event.preventDefault();
          // Render the same last frame immediately on a fresh 2D canvas. Waiting
          // for a driver restoration must never leave a blank site or a dead loop.
          try { fallback('context-lost'); if (lastFrame) render(lastFrame); }
          catch { abandon('context-lost'); }
        };
        canvas.addEventListener('webglcontextlost', lostHandler);
      } catch { fallback('webgl-initialization'); }
    }
    function resize(w, h, dpr) {
      width = Math.max(1, w); height = Math.max(1, h); ratio = Math.max(1, Math.min(2, dpr || 1));
      const physicalWidth = Math.max(1, Math.round(width * ratio)), physicalHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
      if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
      if (gl) gl.viewport(0, 0, physicalWidth, physicalHeight);
      if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    function ensureCapacity(n) {
      if (n <= capacity) return;
      capacity = Math.ceil(n / 256) * 256;
      points = new Float32Array(capacity * POINT_STRIDE);
      ribbons = new Float32Array(capacity * 3 * RIBBON_STRIDE);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, points.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, ribbons.byteLength, gl.DYNAMIC_DRAW);
    }
    function bind(programInfo, buffer, stride, counts, frame) {
      gl.useProgram(programInfo.object); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const location of enabledAttributes) {
        if (!programInfo.attributes.includes(location)) gl.disableVertexAttribArray(location);
      }
      enabledAttributes = programInfo.attributes;
      let offset = 0;
      programInfo.attributes.forEach((location, index) => {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, counts[index], gl.FLOAT, false, stride * 4, offset * 4);
        offset += counts[index];
      });
      const u = programInfo.uniforms;
      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform3fv(u.u_pink, PINK);
      // Both sheen frequencies complete whole cycles within this interval;
      // bounded time also stays precise in mobile mediump fragment shaders.
      gl.uniform1f(u.u_time, frame.still ? 0 : (frame.time * 0.001) % (Math.PI * 100));
      if (u.u_ratio) gl.uniform1f(u.u_ratio, ratio);
    }
    function drawGPU(frame) {
      if (gl.isContextLost()) { fallback('context-lost'); draw2D(frame); return; }
      const { x, y, size, alpha, phase, gain, skip } = frame, n = x.length;
      ensureCapacity(n);
      let pointCount = 0, ribbonCount = 0;
      for (let i = 0; i < n; i += skip) {
        if (x[i] < -12 || x[i] > width + 12 || y[i] < -12 || y[i] > height + 12) continue;
        const next = Math.min(n - 1, i + 7), dx = x[next] - x[i], dy = y[next] - y[i];
        const distance = Math.hypot(dx, dy), depth = 0.5 + 0.5 * Math.sin(phase[i] * 3.0 + (i % 7));
        const angle = distance > 0.1 && distance < 26 ? Math.atan2(dy, dx) : phase[i] * 0.5;
        const p = pointCount++ * POINT_STRIDE;
        points[p] = x[i]; points[p + 1] = y[i]; points[p + 2] = (size[i] ? 9.4 : 7.1) * (0.88 + depth * 0.12);
        points[p + 3] = alpha[i] * gain; points[p + 4] = angle; points[p + 5] = phase[i] * 4.0; points[p + 6] = depth;
        if (i % (2 * skip) || distance <= 0.35 || distance >= 26) continue;
        const halfWidth = 0.48 + depth * 0.24, nx = -dy / distance * halfWidth, ny = dx / distance * halfWidth;
        const opacity = alpha[i] * gain * 0.24;
        for (const corner of TRIANGLE_CORNERS) {
          const r = ribbonCount++ * RIBBON_STRIDE, j = corner < 2 ? i : next, side = corner % 2 ? -1 : 1;
          ribbons[r] = x[j] + nx * side; ribbons[r + 1] = y[j] + ny * side; ribbons[r + 2] = side;
          ribbons[r + 3] = opacity; ribbons[r + 4] = phase[i] * 4.0;
        }
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      bind(ribbonProgram, ribbonBuffer, RIBBON_STRIDE, [2, 3], frame);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ribbons.subarray(0, ribbonCount * RIBBON_STRIDE));
      gl.drawArrays(gl.TRIANGLES, 0, ribbonCount);
      bind(pointProgram, pointBuffer, POINT_STRIDE, [2, 2, 3], frame);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, points.subarray(0, pointCount * POINT_STRIDE));
      gl.drawArrays(gl.POINTS, 0, pointCount);
      if (!drawConfirmed) {
        if (gl.getError() !== gl.NO_ERROR) throw new Error('webgl-first-draw');
        drawConfirmed = true;
      }
    }
    function makeSprites() {
      return Array.from({ length: 8 }, (_, bucket) => {
        const image = document.createElement('canvas'); image.width = image.height = 48;
        const c = image.getContext('2d');
        if (!c) throw new Error('canvas-sprite');
        c.translate(24, 24); c.rotate(bucket * Math.PI / 4); c.scale(1, 0.33);
        const light = c.createRadialGradient(0, 0, 0, 0, 0, 23);
        light.addColorStop(0, 'rgba(255,184,224,1)');
        light.addColorStop(0.16, 'rgba(247,21,172,0.94)');
        light.addColorStop(0.5, 'rgba(247,21,172,0.28)');
        light.addColorStop(1, 'rgba(247,21,172,0)');
        c.fillStyle = light; c.fillRect(-24, -24, 48, 48);
        return image;
      });
    }
    function draw2D(frame) {
      if (!ctx) return;
      if (!sprites) sprites = makeSprites();
      const { x, y, size, alpha, phase, gain, skip } = frame, n = x.length;
      ctx.clearRect(0, 0, width, height); ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); ctx.strokeStyle = '#f715ac'; ctx.lineWidth = 0.65; ctx.globalAlpha = 0.13 * gain;
      for (let i = 0; i < n - 7; i += 2 * skip) {
        const dx = x[i + 7] - x[i], dy = y[i + 7] - y[i], d2 = dx * dx + dy * dy;
        if (d2 > 0.12 && d2 < 676) { ctx.moveTo(x[i], y[i]); ctx.lineTo(x[i + 7], y[i + 7]); }
      }
      ctx.stroke();
      for (let i = 0; i < n; i += skip) {
        if (x[i] < -12 || x[i] > width + 12 || y[i] < -12 || y[i] > height + 12) continue;
        const j = Math.min(n - 1, i + 7), dx = x[j] - x[i], dy = y[j] - y[i], distance = Math.hypot(dx, dy);
        const angle = distance > 0.1 && distance < 26 ? Math.atan2(dy, dx) : phase[i] * 0.5;
        const sprite = sprites[(Math.round(angle / (Math.PI / 4)) + 8) % 8], extent = size[i] ? 9.4 : 7.1;
        ctx.globalAlpha = alpha[i] * gain;
        ctx.drawImage(sprite, x[i] - extent / 2, y[i] - extent / 2, extent, extent);
      }
      ctx.globalAlpha = 1;
    }
    function render(frame) {
      lastFrame = frame;
      try {
        if (gl) drawGPU(frame);
        else draw2D(frame);
      } catch {
        try {
          if (gl) fallback('webgl-draw');
          else { abandon('canvas-draw'); return; }
          draw2D(frame);
        } catch { abandon('canvas-draw'); }
      }
    }
    function abandon(reason) {
      releaseGPU(); ctx = null; mode = 'none'; fallbackReason = reason;
      canvas.dataset.fieldRenderer = mode;
    }
    function clear() {
      lastFrame = null;
      if (gl && !gl.isContextLost()) gl.clear(gl.COLOR_BUFFER_BIT);
      if (ctx) ctx.clearRect(0, 0, width, height);
    }
    function readPixels() {
      // Read the actual displayed canvas. WebGL's non-preserved buffer is drawn
      // synchronously from the last frame immediately before its pixels are read.
      // This path runs only on request; regular rendering has no GPU readback.
      if (lastFrame) render(lastFrame);
      const w = canvas.width, h = canvas.height;
      if (gl) {
        const bottomUp = new Uint8Array(w * h * 4), data = new Uint8Array(bottomUp.length);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
        for (let row = 0; row < h; row++) data.set(bottomUp.subarray(row * w * 4, (row + 1) * w * 4), (h - row - 1) * w * 4);
        return { width: w, height: h, data };
      }
      if (ctx) return ctx.getImageData(0, 0, w, h);
      return { width: w, height: h, data: new Uint8Array(w * h * 4) };
    }
    setupGPU();
    return Object.freeze({ resize, render, clear, readPixels,
      state: () => ({ renderer: mode, fallbackReason, width: canvas.width, height: canvas.height }) });
  }
  window.REYZFieldRenderer = Object.freeze({ create });
})();
