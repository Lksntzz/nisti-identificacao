import React from 'react';

// A single invalid/unsupported effect inside an active call must not collapse
// the entire 24/7 expedition monitor. New calls get a new keyed instance.
export default class MonitorCallBoundary extends React.Component {
  constructor(props){super(props);this.state={failed:false}}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(error){
    console.error('[Monitor NISTI] Falha isolada na notificação',
      error?.name||'render_error',String(error?.message||'').slice(0,160));
  }
  render(){
    if(!this.state.failed)return this.props.children;
    const platform=typeof this.props.platform==='string'?this.props.platform:'Expedição';
    const message=typeof this.props.message==='string'?this.props.message:'RETIRAR CAPA';
    return <section className="nid-live-request nid-live-v5 nid-live-fallback" aria-live="polite">
      <div className="nid-live-fallback-title">{platform}</div>
      <div className="nid-live-fallback-message">{message}</div>
    </section>;
  }
}
