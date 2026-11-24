// Harness SOMENTE de teste: monta a Visão estratégica real contra uma API simulada (ver strategic-view.mjs).
import React from 'react';
import {createRoot} from 'react-dom/client';
import CommerceStrategicView from '../../src/ga/commerce-strategic-view.jsx';
createRoot(document.getElementById('root')).render(<CommerceStrategicView/>);
