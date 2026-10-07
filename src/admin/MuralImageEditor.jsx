import React, { useState, useRef, useEffect, useCallback } from 'react';

const ASPECT_RATIOS = [
  { label: 'Livre', value: 'free', ratio: null },
  { label: '1:1 Quadrado', value: '1:1', ratio: 1 },
  { label: '4:3 Card', value: '4:3', ratio: 4 / 3 },
  { label: '16:9 Banner', value: '16:9', ratio: 16 / 9 },
  { label: '3:4 Editorial', value: '3:4', ratio: 3 / 4 }
];

const FILTER_PRESETS = [
  { name: 'Original', brightness: 100, contrast: 100, saturate: 100 },
  { name: 'Editorial', brightness: 104, contrast: 110, saturate: 108 },
  { name: 'Vibrante', brightness: 102, contrast: 115, saturate: 125 },
  { name: 'Suave Travertino', brightness: 106, contrast: 95, saturate: 90 },
  { name: 'P&B Clássico', brightness: 102, contrast: 120, saturate: 0 }
];

export default function MuralImageEditor({ imageUrl, onApply, onClose }) {
  const [imageBitmap, setImageBitmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Crop & Transform state
  const [aspect, setAspect] = useState('4:3');
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [flipH, setFlipH] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Color & Filter adjustments
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturate, setSaturate] = useState(100);
  const [activePreset, setActivePreset] = useState('Original');

  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Load image
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    img.onload = () => {
      if (!active) return;
      createImageBitmap(img).then(bmp => {
        if (!active) return;
        setImageBitmap(bmp);
        setLoading(false);
      }).catch(() => {
        if (!active) return;
        setImageBitmap(img);
        setLoading(false);
      });
    };
    img.onerror = () => {
      if (!active) return;
      setError('Não foi possível carregar a imagem para edição.');
      setLoading(false);
    };

    return () => { active = false; };
  }, [imageUrl]);

  // Apply preset
  const applyPreset = preset => {
    setActivePreset(preset.name);
    setBrightness(preset.brightness);
    setContrast(preset.contrast);
    setSaturate(preset.saturate);
  };

  // Rotate
  const rotateLeft = () => setRotation(r => (r - 90 + 360) % 360);
  const rotateRight = () => setRotation(r => (r + 90) % 360);
  const toggleFlip = () => setFlipH(f => !f);

  // Reset transforms
  const resetAll = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipH(false);
    setAspect('4:3');
    applyPreset(FILTER_PRESETS[0]);
  };

  // Mouse pan handlers
  const handleMouseDown = e => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = e => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Render on preview canvas
  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !imageBitmap) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const container = containerRef.current;
    if (!container) return;

    // Viewport size
    const cw = container.clientWidth || 500;
    const ch = container.clientHeight || 360;
    canvas.width = cw;
    canvas.height = ch;

    ctx.clearRect(0, 0, cw, ch);

    // Apply color filters
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;

    ctx.save();
    ctx.translate(cw / 2 + pan.x, ch / 2 + pan.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -zoom : zoom, zoom);

    // Compute aspect scaling
    const isSideways = rotation === 90 || rotation === 270;
    const imgW = isSideways ? imageBitmap.height : imageBitmap.width;
    const imgH = isSideways ? imageBitmap.width : imageBitmap.height;
    const fitScale = Math.min((cw * 0.85) / imgW, (ch * 0.85) / imgH);

    const drawW = imageBitmap.width * fitScale;
    const drawH = imageBitmap.height * fitScale;

    ctx.drawImage(imageBitmap, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Reset filter for crop overlay
    ctx.filter = 'none';

    // Draw crop guide overlay if aspect is chosen
    const selectedRatioObj = ASPECT_RATIOS.find(a => a.value === aspect);
    if (selectedRatioObj && selectedRatioObj.ratio) {
      const targetRatio = selectedRatioObj.ratio;
      let cropW, cropH;
      const maxW = cw * 0.85;
      const maxH = ch * 0.85;

      if (maxW / maxH > targetRatio) {
        cropH = maxH;
        cropW = cropH * targetRatio;
      } else {
        cropW = maxW;
        cropH = cropW / targetRatio;
      }

      const cropX = (cw - cropW) / 2;
      const cropY = (ch - cropH) / 2;

      // Darken outside
      ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.fillRect(0, 0, cw, cropY); // Top
      ctx.fillRect(0, cropY + cropH, cw, ch - (cropY + cropH)); // Bottom
      ctx.fillRect(0, cropY, cropX, cropH); // Left
      ctx.fillRect(cropX + cropW, cropY, cw - (cropX + cropW), cropH); // Right

      // Crisp border
      ctx.strokeStyle = '#2f6bff';
      ctx.lineWidth = 2;
      ctx.strokeRect(cropX, cropY, cropW, cropH);

      // Rule of thirds lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Verticals
      ctx.moveTo(cropX + cropW / 3, cropY);
      ctx.lineTo(cropX + cropW / 3, cropY + cropH);
      ctx.moveTo(cropX + (2 * cropW) / 3, cropY);
      ctx.lineTo(cropX + (2 * cropW) / 3, cropY + cropH);
      // Horizontals
      ctx.moveTo(cropX, cropY + cropH / 3);
      ctx.lineTo(cropX + cropW, cropY + cropH / 3);
      ctx.moveTo(cropX, cropY + (2 * cropH) / 3);
      ctx.lineTo(cropX + cropW, cropY + (2 * cropH) / 3);
      ctx.stroke();
    }
  }, [imageBitmap, aspect, rotation, flipH, zoom, pan, brightness, contrast, saturate]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Export cropped & processed image as a new File
  const handleApply = async () => {
    if (!imageBitmap) return;

    // Output target dimensions
    const selectedRatioObj = ASPECT_RATIOS.find(a => a.value === aspect);
    const targetRatio = selectedRatioObj?.ratio || (imageBitmap.width / imageBitmap.height);
    const maxOutputW = 1280;
    const outputW = maxOutputW;
    const outputH = Math.round(outputW / targetRatio);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outputW;
    outCanvas.height = outputH;
    const ctx = outCanvas.getContext('2d', { alpha: false });

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outputW, outputH);

    // Apply color filter
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`;

    ctx.save();
    ctx.translate(outputW / 2 + (pan.x * (outputW / (canvasRef.current?.width || outputW))), outputH / 2 + (pan.y * (outputH / (canvasRef.current?.height || outputH))));
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -zoom : zoom, zoom);

    const isSideways = rotation === 90 || rotation === 270;
    const imgW = isSideways ? imageBitmap.height : imageBitmap.width;
    const imgH = isSideways ? imageBitmap.width : imageBitmap.height;
    const scale = Math.max(outputW / imgW, outputH / imgH);

    const dw = imageBitmap.width * scale;
    const dh = imageBitmap.height * scale;

    ctx.drawImage(imageBitmap, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    outCanvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], 'mural-edited-art.jpg', { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      onApply({ file, url });
      onClose();
    }, 'image/jpeg', 0.88);
  };

  return (
    <div className="mural-image-editor-modal" role="dialog" aria-modal="true" aria-label="Editor de Imagem">
      <div className="mural-image-editor-dialog">
        <header className="mural-image-editor-header">
          <div className="mural-image-editor-title">
            <span className="editor-icon" aria-hidden="true">🎨</span>
            <div>
              <h3>Editor de Imagem do Mural</h3>
              <p>Corte, rotação, zoom e filtros de acabamento editorial.</p>
            </div>
          </div>
          <button type="button" className="mural-image-editor-close" onClick={onClose} aria-label="Fechar editor">
            ✕
          </button>
        </header>

        <div className="mural-image-editor-body">
          <div
            ref={containerRef}
            className={`mural-image-editor-stage ${isDragging ? 'is-dragging' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {loading ? (
              <div className="mural-image-editor-loading">Carregando imagem…</div>
            ) : error ? (
              <div className="mural-image-editor-error">{error}</div>
            ) : (
              <canvas ref={canvasRef} className="mural-image-editor-canvas" />
            )}
            <div className="mural-image-editor-hint">
              <span>Arraste para reposicionar • Use o zoom abaixo</span>
            </div>
          </div>

          <aside className="mural-image-editor-sidebar">
            <section className="mural-editor-group">
              <label className="mural-editor-label">Proporção de Corte</label>
              <div className="mural-editor-aspect-grid">
                {ASPECT_RATIOS.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={`mural-editor-btn ${aspect === item.value ? 'active' : ''}`}
                    onClick={() => setAspect(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="mural-editor-group">
              <label className="mural-editor-label">Zoom & Enquadramento</label>
              <div className="mural-editor-slider-row">
                <span>🔍</span>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.05"
                  value={zoom}
                  onChange={e => setZoom(parseFloat(e.target.value))}
                />
                <span className="mural-editor-val">{Math.round(zoom * 100)}%</span>
              </div>
            </section>

            <section className="mural-editor-group">
              <label className="mural-editor-label">Orientação & Giro</label>
              <div className="mural-editor-tools-row">
                <button type="button" className="mural-editor-action-btn" onClick={rotateLeft} title="Girar 90° à esquerda">
                  ↺ 90°
                </button>
                <button type="button" className="mural-editor-action-btn" onClick={rotateRight} title="Girar 90° à direita">
                  ↻ 90°
                </button>
                <button type="button" className={`mural-editor-action-btn ${flipH ? 'active' : ''}`} onClick={toggleFlip} title="Espelhar horizontal">
                  ⇄ Espelhar
                </button>
                <button type="button" className="mural-editor-action-btn" onClick={resetAll} title="Resetar transformações">
                  Restaurar
                </button>
              </div>
            </section>

            <section className="mural-editor-group">
              <label className="mural-editor-label">Estilos & Filtros</label>
              <div className="mural-editor-presets-row">
                {FILTER_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    type="button"
                    className={`mural-editor-preset-pill ${activePreset === preset.name ? 'active' : ''}`}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </section>

            <section className="mural-editor-group">
              <label className="mural-editor-label">Ajustes Finos</label>
              <div className="mural-editor-slider-col">
                <div className="slider-item">
                  <small>Brilho ({brightness}%)</small>
                  <input
                    type="range"
                    min="50"
                    max="150"
                    value={brightness}
                    onChange={e => setBrightness(parseInt(e.target.value, 10))}
                  />
                </div>
                <div className="slider-item">
                  <small>Contraste ({contrast}%)</small>
                  <input
                    type="range"
                    min="50"
                    max="160"
                    value={contrast}
                    onChange={e => setContrast(parseInt(e.target.value, 10))}
                  />
                </div>
                <div className="slider-item">
                  <small>Saturação ({saturate}%)</small>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={saturate}
                    onChange={e => setSaturate(parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
            </section>
          </aside>
        </div>

        <footer className="mural-image-editor-footer">
          <button type="button" className="mural-editor-cancel" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="mural-editor-confirm" onClick={handleApply} disabled={loading || !imageBitmap}>
            ✓ Aplicar Imagem Editada
          </button>
        </footer>
      </div>
    </div>
  );
}
