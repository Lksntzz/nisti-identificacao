import React, { useEffect, useMemo, useRef, useState } from 'react';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  return out;
}

function identity() {
  return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function translation(x, y, z) {
  const out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

function rotationX(radians) {
  const c = Math.cos(radians), s = Math.sin(radians);
  return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]);
}

function rotationY(radians) {
  const c = Math.cos(radians), s = Math.sin(radians);
  return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);
}

function scaling(x, y, z) {
  return new Float32Array([x,0,0,0,0,y,0,0,0,0,z,0,0,0,0,1]);
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || 'Falha ao compilar shader.');
  }
  return shader;
}

function createProgram(gl) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 a_position;
    attribute vec2 a_uv;
    uniform mat4 u_matrix;
    varying vec2 v_uv;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 1.0);
      v_uv = a_uv;
    }
  `);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_light;
    void main() {
      vec4 color = texture2D(u_texture, v_uv);
      gl_FragColor = vec4(color.rgb * u_light, color.a);
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(message || 'Falha ao iniciar renderização 3D.');
  }
  return program;
}

function ProductWebGL({ imageUrl, title, activeStep }) {
  const canvasRef = useRef(null);
  const [available, setAvailable] = useState(true);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const activeStepRef = useRef(activeStep);
  const dragRef = useRef({ active:false, x:0, y:0, rx:0, ry:0 });

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  useEffect(() => {
    if (!imageUrl || prefersReducedMotion()) {
      setAvailable(false);
      return undefined;
    }

    setAvailable(true);
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl', { alpha:true, antialias:true, premultipliedAlpha:false });
    if (!gl) {
      setAvailable(false);
      return undefined;
    }

    let stopped = false;
    let frame = 0;
    let resizeObserver;
    let image;
    let texture;
    let program;
    let positionBuffer;
    let uvBuffer;
    let naturalAspect = 0.72;
    let currentRx = -0.04;
    let currentRy = 0;
    let currentZoom = 1;

    try {
      program = createProgram(gl);
      const positionLocation = gl.getAttribLocation(program, 'a_position');
      const uvLocation = gl.getAttribLocation(program, 'a_uv');
      const matrixLocation = gl.getUniformLocation(program, 'u_matrix');
      const lightLocation = gl.getUniformLocation(program, 'u_light');

      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,0, 1,-1,0, -1,1,0,
        -1,1,0, 1,-1,0, 1,1,0
      ]), gl.STATIC_DRAW);

      uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0,1, 1,1, 0,0,
        0,0, 1,1, 1,0
      ]), gl.STATIC_DRAW);

      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([244,247,251,255]));

      image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => {
        if (stopped) return;
        naturalAspect = Math.max(0.45, Math.min(1.25, image.naturalWidth / image.naturalHeight));
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      };
      image.onerror = () => !stopped && setAvailable(false);
      image.src = imageUrl;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0,0,width,height);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      resize();

      const stepRotations = [
        { x:-0.04, y:-0.08, z:1.0 },
        { x:0.03, y:0.42, z:1.06 },
        { x:-0.08, y:-0.38, z:1.12 },
        { x:0.02, y:0.14, z:1.0 }
      ];

      const render = () => {
        if (stopped) return;
        resize();

        const step = activeStepRef.current;
        const target = stepRotations[Math.max(0, Math.min(stepRotations.length - 1, step))] || stepRotations[0];
        const drag = dragRef.current;
        if (!drag.active) {
          drag.rx *= 0.94;
          drag.ry *= 0.94;
          if (Math.abs(drag.rx) < 0.001) drag.rx = 0;
          if (Math.abs(drag.ry) < 0.001) drag.ry = 0;
        }
        const targetRx = target.x + drag.rx;
        const targetRy = target.y + drag.ry;
        currentRx += (targetRx - currentRx) * 0.08;
        currentRy += (targetRy - currentRy) * 0.08;
        currentZoom += ((target.z * zoomRef.current) - currentZoom) * 0.08;

        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation,3,gl.FLOAT,false,0,0);

        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation,2,gl.FLOAT,false,0,0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        const aspect = canvas.width / Math.max(canvas.height, 1);
        const projection = perspective(new Float32Array(16), Math.PI / 4.4, aspect, 0.1, 100);
        const view = translation(0, 0, -4.2);
        const modelScale = scaling(naturalAspect * 1.55 * currentZoom, 1.55 * currentZoom, 1);
        const rotation = multiply(rotationY(currentRy), rotationX(currentRx));
        const matrix = multiply(projection, multiply(view, multiply(rotation, modelScale)));

        gl.uniformMatrix4fv(matrixLocation,false,matrix);
        gl.uniform1f(lightLocation, Math.max(0.82, 1 - Math.abs(currentRy) * 0.12));
        gl.drawArrays(gl.TRIANGLES,0,6);

        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);
    } catch {
      setAvailable(false);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      if (gl) {
        if (positionBuffer) gl.deleteBuffer(positionBuffer);
        if (uvBuffer) gl.deleteBuffer(uvBuffer);
        if (texture) gl.deleteTexture(texture);
        if (program) gl.deleteProgram(program);
      }
    };
  }, [imageUrl]);

  const pointerDown = event => {
    if (!available) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current.active = true;
    dragRef.current.x = event.clientX;
    dragRef.current.y = event.clientY;
  };

  const pointerMove = event => {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.ry = Math.max(-0.75, Math.min(0.75, drag.ry + dx * 0.008));
    drag.rx = Math.max(-0.4, Math.min(0.4, drag.rx + dy * 0.005));
  };

  const pointerUp = event => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current.active = false;
  };

  if (!available || !imageUrl) {
    return imageUrl ? <img className="mural-product-stage-fallback" src={imageUrl} alt={title} /> : null;
  }

  return (
    <div className="mural-product-webgl">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Visualização interativa em perspectiva de ${title}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      />
      <div className="mural-product-webgl-hint" aria-hidden="true">Arraste para explorar</div>
      <div className="mural-product-webgl-controls" aria-label="Controles de zoom">
        <button type="button" onClick={() => setZoom(value => Math.max(.82, +(value - .12).toFixed(2)))} aria-label="Diminuir zoom">−</button>
        <button type="button" onClick={() => setZoom(value => Math.min(1.42, +(value + .12).toFixed(2)))} aria-label="Aumentar zoom">+</button>
      </div>
    </div>
  );
}

export default function MuralProductExperience({ item }) {
  const storyRef = useRef(null);
  const [activeStep, setActiveStep] = useState(0);

  const steps = useMemo(() => {
    const product = item?.product || {};
    return [
      {
        eyebrow: product.type || 'Produto',
        title: item?.title || 'Produto NISTI',
        body: item?.body || item?.subtitle || 'Detalhes do produto.'
      },
      {
        eyebrow: 'Identificação',
        title: product.collection || 'Catálogo NISTI',
        body: product.sku ? `SKU ${product.sku}` : 'Produto integrado ao catálogo atual.'
      },
      {
        eyebrow: 'Acabamentos',
        title: [product.wireo, product.tassel, product.elastico].filter(Boolean).join(' · ') || 'Configuração atual',
        body: 'Os acabamentos exibidos acompanham os dados atuais do produto.'
      },
      {
        eyebrow: 'Informação editorial',
        title: item?.subtitle || 'Conteúdo do Mural',
        body: item?.published_at ? `Publicado em ${new Date(item.published_at).toLocaleDateString('pt-BR')}` : 'Conteúdo do Mural NISTI.'
      }
    ];
  }, [item]);

  useEffect(() => {
    const root = storyRef.current?.closest('.mural-detail') || null;
    const nodes = [...(storyRef.current?.querySelectorAll('[data-story-step]') || [])];
    if (!nodes.length || prefersReducedMotion()) return undefined;

    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveStep(Number(visible.target.dataset.storyStep || 0));
    }, { root, threshold:[.35,.55,.75] });

    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [steps.length]);

  useEffect(() => {
    const story = storyRef.current;
    const root = story?.closest('.mural-detail');
    if (!story || !root || prefersReducedMotion()) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const max = Math.max(1, root.scrollHeight - root.clientHeight);
      const progress = Math.max(0, Math.min(1, root.scrollTop / max));
      story.style.setProperty('--story-progress', String(progress));
      story.style.setProperty('--story-parallax', `${Math.round(progress * 28)}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    root.addEventListener('scroll', onScroll, { passive:true });
    update();
    return () => {
      root.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="mural-product-story" ref={storyRef}>
      <div className="mural-product-stage" data-story-active={activeStep}>
        <div className="mural-product-story-progress" aria-hidden="true">
          {steps.map((_, index) => (
            <span
              key={index}
              className={index === activeStep ? 'active' : index < activeStep ? 'complete' : ''}
            />
          ))}
        </div>
        <div className="mural-product-orb mural-product-orb-a" aria-hidden="true" />
        <div className="mural-product-orb mural-product-orb-b" aria-hidden="true" />
        <ProductWebGL imageUrl={item?.image_url} title={item?.title || 'Produto'} activeStep={activeStep} />
        <div className="mural-product-stage-caption">
          <span>{item?.badge || 'NISTI'}</span>
          <strong>{item?.product?.type || item?.title}</strong>
        </div>
      </div>

      <div className="mural-product-story-copy">
        {steps.map((step, index) => (
          <section
            key={`${step.eyebrow}-${index}`}
            data-story-step={index}
            className={`mural-product-story-step${activeStep === index ? ' active' : ''}`}
            aria-current={activeStep === index ? 'step' : undefined}
          >
            <span>{step.eyebrow}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </section>
        ))}

        <section className="mural-product-facts" aria-label="Detalhes do produto">
          <span className="mural-product-facts-title">Detalhes</span>
          {item?.product?.sku && <div><span>SKU</span><strong>{item.product.sku}</strong></div>}
          {item?.product?.collection && <div><span>Coleção</span><strong>{item.product.collection}</strong></div>}
          {item?.product?.wireo && <div><span>Wire-o</span><strong>{item.product.wireo}</strong></div>}
          {item?.product?.tassel && <div><span>Tassel</span><strong>{item.product.tassel}</strong></div>}
          {item?.product?.elastico && <div><span>Elástico</span><strong>{item.product.elastico}</strong></div>}
        </section>
      </div>
    </div>
  );
}
