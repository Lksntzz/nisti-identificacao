import fs from 'node:fs';

// Legacy UI assertions inspect the publishing feature across all extracted modules.
// Keep their original text order while dedicated tests verify actual module wiring.
const moduleNames = [
  'MuralPublishShared.jsx',
  'MuralPublishComponents.jsx',
  'MuralPublishWorkspace.jsx',
  'MuralNistiAdminView.jsx'
];

export const muralAdminSource = moduleNames
  .map(name => fs.readFileSync(new URL('../../src/admin/' + name, import.meta.url), 'utf8'))
  .join('\n');
