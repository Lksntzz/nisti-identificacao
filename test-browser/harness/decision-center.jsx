// Harness SOMENTE de teste: monta a Central de decisões real contra uma API simulada (ver decision-center.mjs).
import React from 'react';
import {createRoot} from 'react-dom/client';
import CommerceDecisionCenter from '../../src/ga/commerce-decision-center.jsx';
createRoot(document.getElementById('root')).render(<CommerceDecisionCenter/>);
