import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const listing = fs.readFileSync('src/commerce-ad-manager.jsx', 'utf8');
const summary = fs.readFileSync('src/commerce-shopee-ads-summary.jsx', 'utf8');
const css = fs.readFileSync('src/commerce-shopee-ads-summary.css', 'utf8');

test('Shopee Ads is accessible directly below performance, before tabs', () => {
  const detail = listing.slice(listing.indexOf('function ListingDetail('),
    listing.indexOf('export default function CommerceCommercialDashboard'));
  const p = detail.indexOf('<CommerceShopeeAdsSummary listingId={item.id}/>');
  const tabs = detail.indexOf('<div className="nim-detail-tab-list"');
  const perfEnd = detail.indexOf('</section>', detail.indexOf('className="nim-detail-performance"'));
  assert.ok(p > perfEnd, 'Shopee Ads is after sales indicators');
  assert.ok(p < tabs, 'Shopee Ads is before the tabs and long monthly history');
  assert.equal(detail.split('<CommerceShopeeAdsSummary listingId={item.id}/>').length-1, 1);
  assert.match(detail, /item.source==='SHOPEE'/);
});

test('access label is explicit and old diagnosis button is gone', () => {
  assert.match(summary, /Publicidade Shopee Ads/);
  assert.match(summary, /Consultar relatório importado/);
  assert.match(css, /\.nim-detail>\.nim-ads-evidence/);
  assert.match(listing, />Ver detalhes →<\/button>/);
  assert.doesNotMatch(listing, /Ver diagnóstico →|Abrir diagnóstico do anúncio/);
  assert.match(listing, /const DETAIL_TABS=\[\['summary','Resumo'\]/);
});
