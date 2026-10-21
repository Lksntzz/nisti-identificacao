import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = name => fs.readFileSync(new URL('../src/admin/' + name, import.meta.url), 'utf8');
const main = read('MuralNistiAdminView.jsx');
const shared = read('MuralPublishShared.jsx');
const components = read('MuralPublishComponents.jsx');
const workspace = read('MuralPublishWorkspace.jsx');

test('Mural entry owns navigation and data loading while editors stay outside the entry', () => {
  assert.match(main, /import \{ PostEditor, CollectionEditor \} from '\.\/MuralPublishWorkspace\.jsx'/);
  assert.match(main, /import \{ AdminMuralIcon, request \} from '\.\/MuralPublishShared\.jsx'/);
  assert.match(main, /import MuralProductImageManager from '\.\/MuralProductImageManager\.jsx'/);
  assert.match(main, /export default function MuralNistiAdminView/);
  assert.match(main, /if \(collectionEditor\)/);
  assert.match(main, /if \(editor\)/);
  assert.match(main, /if \(section === 'publish'\)/);
  assert.doesNotMatch(main, /function (MuralPublishWorkspace|PostEditor|CollectionEditor|CanvaArtworkModal|PublishImageField|PublishPreviewCard)\(/);
  assert.ok(main.split('\n').length < 250, 'Mural entry must stay limited to orchestration');
});

test('publish workspace maintains the same unified editor for product, notice and collection', () => {
  assert.match(workspace, /function MuralPublishWorkspace/);
  assert.match(workspace, /export function PostEditor/);
  assert.match(workspace, /export function CollectionEditor/);
  assert.match(workspace, /return <MuralPublishWorkspace \{\.\.\.props\} initialKind="collection"/);
  assert.match(workspace, /<CanvaArtworkModal/);
  assert.match(workspace, /<PublishImageField/);
  assert.match(workspace, /<PublishPreviewCard/);
  assert.match(workspace, /request\('\/api\/admin\/mural\/posts'/);
  assert.match(workspace, /request\('\/api\/admin\/mural\/collections'/);
  assert.match(workspace, /onOpenExistingCollection/);
  assert.doesNotMatch(workspace, /\bfetch\s*\(/);
});

test('publish controls preserve Canva, attachment and responsive preview components', () => {
  assert.match(components, /export function CanvaArtworkModal/);
  assert.match(components, /export function PublishImageField/);
  assert.match(components, /export function PublishPreviewCard/);
  assert.match(components, /from '\.\/MuralPublishShared\.jsx'/);
  assert.match(components, /from '\.\.\/mural-nisti\.jsx'/);
  assert.match(components, /Arte da publicação · Canva/);
  assert.match(components, /Prévia 100% interativa/);
  assert.match(components, /fetch\(src, \{ credentials: 'same-origin', cache: 'no-store' \}\)/);
});

test('shared Mural requests preserve same-origin credentials and existing normalization', () => {
  assert.match(shared, /export async function request\(/);
  assert.match(shared, /credentials: 'same-origin', cache: 'no-store'/);
  assert.match(shared, /export async function requestBlob\(/);
  assert.match(shared, /export function postForm\(/);
  assert.match(shared, /export function TransparentMuralProductImage\(/);
  assert.match(shared, /export async function compressImage\(/);
  assert.match(shared, /export const EMPTY_POST/);
  assert.doesNotMatch(shared, /\/api\/publications\/delete/);
});
