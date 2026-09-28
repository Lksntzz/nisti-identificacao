import React from 'react';
import { createRoot } from 'react-dom/client';
import CommerceAdminAppV2 from './commerce-admin-app-v2.jsx';

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<CommerceAdminAppV2 />);
}
