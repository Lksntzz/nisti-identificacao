import React from 'react';
import { buildListingDiagnosis } from './commerce-listing-diagnostics.js';
import CommerceTrafficMetrics from './commerce-traffic-metrics.jsx';
import './commerce-listing-diagnosis-panel.css';

export default function ListingDiagnosisPanel({item,days,start,end}) {
  const report = buildListingDiagnosis(item,days);
  return <section className="nim-diagnosis" aria-label="Diagnóstico do anúncio">
    <div className={'nim-diagnosis-summary '+report.summary.tone}>
      <small>Diagnóstico com evidências disponíveis</small>
      <h4>{report.summary.title}</h4>
      <p>{report.summary.detail}</p>
    </div>
    <CommerceTrafficMetrics listingId={item.id} start={start} end={end}/>
    <div className="nim-diagnosis-section">
      <h4>O que os dados demonstram</h4>
      {report.signals.length===0
        ? <p className="nim-diagnosis-muted">Nenhum alerta objetivo encontrado nos dados de vendas disponíveis. Isso não demonstra que título, imagem, preço ou tráfego estejam adequados.</p>
        : <div className="nim-diagnosis-signals">
          {report.signals.map(signal=><div className={'nim-diagnosis-signal '+signal.tone} key={signal.id}>
            <strong>{signal.label}</strong><p>{signal.evidence}</p>
          </div>)}
        </div>}
    </div>
    <div className="nim-diagnosis-section">
      <h4>Possíveis causas a investigar</h4>
      <p className="nim-diagnosis-muted">Checklist de investigação, não conclusão automática sobre a causa.</p>
      <div className="nim-diagnosis-checks">
        {report.checks.map((check,i)=><div className="nim-diagnosis-check" key={check.id}>
          <div className="nim-diagnosis-check-heading">
            <strong>{i+1}. {check.title}</strong>
            <span>{check.status}</span>
          </div>
          <p>{check.detail}</p>
          <small><b>Próxima ação:</b> {check.action}</small>
        </div>)}
      </div>
    </div>
    <p className="nim-diagnosis-missing"><strong>Dados ainda não integrados:</strong> {report.missing.join(' · ')}.
      Essas informações precisam vir de relatórios oficiais ou integrações autorizadas para um diagnóstico causal mais preciso.</p>
    <p className="nim-diagnosis-muted">{report.disclaimer}</p>
  </section>;
}
