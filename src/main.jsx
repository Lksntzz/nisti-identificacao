import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return <main className="shell"><section className="card"><p className="eyebrow">NISTI PRINT</p><h1>Identificação de Produto</h1><p>Primeira versão técnica em construção.</p><button disabled>Tirar foto</button></section></main>;
}

createRoot(document.getElementById('root')).render(<App />);
