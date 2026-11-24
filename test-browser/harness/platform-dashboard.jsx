// Harness SOMENTE de teste: monta o Dashboard Comercial real contra uma API simulada (ver platform-dashboard.mjs).
import React from 'react';
import {createRoot} from 'react-dom/client';
import CommerceDashboard from '../../src/ga/commerce-dashboard.jsx';
const mode=new URLSearchParams(location.search).get('mode')==='explorer'?'explorer':'overview';
createRoot(document.getElementById('root')).render(<CommerceDashboard mode={mode}/>);
