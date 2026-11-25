// Harness SOMENTE de teste: monta a Evolução ABC real contra uma API simulada (ver abc-evolution.mjs).
import React from 'react';
import {createRoot} from 'react-dom/client';
import CommerceAbcEvolution from '../../src/ga/commerce-abc-evolution.jsx';
createRoot(document.getElementById('root')).render(<CommerceAbcEvolution/>);
