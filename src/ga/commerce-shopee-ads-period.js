// Campaign reports contain accumulated values for their *whole* export window.
// A long report cannot be prorated into seven, thirty, sixty or ninety days.
export function shopeeAdsRowsForPeriod(items,start,end,onlySelectedPeriod=true){
  const rows=Array.isArray(items)?items:[];
  if(!onlySelectedPeriod)return rows;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||
    !/^\d{4}-\d{2}-\d{2}$/.test(end||'')||start>end)return [];
  return rows.filter(row=>row?.start===start&&row?.end===end);
}
export function preferredShopeeAdsReport(rows){
  const reports=Array.isArray(rows)?rows:[];
  return reports.find(row=>row?.report_kind==='GENERAL')||reports[0]||null;
}
