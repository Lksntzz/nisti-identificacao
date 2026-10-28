import React,{useEffect,useRef,useState} from 'react';
import CommerceImportModal from './commerce-import-modal.jsx';
import {COMMERCE_IMPORT_OPTIONS} from './commerce-import-options.js';
import CommerceDashboard from './commerce-dashboard.jsx';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import './commerce-ad-manager.css';
import './nisti-reactbits-adaptations.css';
import './commerce-approved-layout.css';
import './commerce-reactbits-lucide.css';

// Painel Comercial: desempenho dos anúncios (melhores, em queda, pararam, sem vendas, ads, ABC)
// com os filtros de período e plataforma, mais o menu de importação de relatórios.
export default function CommerceCommercialPanel({perfOpen=null}){
  const [refresh,setRefresh]=useState(0);
  const [importMenuOpen,setImportMenuOpen]=useState(false);
  const [selectedImportMode,setSelectedImportMode]=useState(null);
  const importMenuRef=useRef(null);
  const importTriggerRef=useRef(null);
  useEffect(()=>{
    if(!importMenuOpen)return undefined;
    const handleOutside=event=>{if(!importMenuRef.current?.contains(event.target))setImportMenuOpen(false);};
    const handleEscape=event=>{if(event.key==='Escape'){setImportMenuOpen(false);importTriggerRef.current?.focus();}};
    document.addEventListener('pointerdown',handleOutside);
    document.addEventListener('keydown',handleEscape);
    return ()=>{document.removeEventListener('pointerdown',handleOutside);document.removeEventListener('keydown',handleEscape);};
  },[importMenuOpen]);
  const openImportType=mode=>{
    if(!COMMERCE_IMPORT_OPTIONS.some(option=>option.mode===mode))return;
    setImportMenuOpen(false);
    setSelectedImportMode(mode);
  };
  const importMenu=(<div className="nim-import-dropdown" ref={importMenuRef}>
          <button type="button" className="nim-primary-button" ref={importTriggerRef}
            onClick={()=>setImportMenuOpen(open=>!open)} aria-haspopup="menu"
            aria-controls="nim-import-options" aria-expanded={importMenuOpen}>
            <CommercialIcon name="upload" size={16}/> Importar arquivo
            <span className="nim-import-trigger-arrow" aria-hidden="true">▾</span>
          </button>
          {importMenuOpen&&<div id="nim-import-options" className="nim-import-options" role="menu" aria-label="Escolher tipo de relatório">
            {COMMERCE_IMPORT_OPTIONS.map(option=><button type="button" role="menuitem" key={option.mode} onClick={()=>openImportType(option.mode)}>
              <span className="nim-import-option-icon" aria-hidden="true"><CommercialIcon name={option.icon} size={18}/></span>
              <span className="nim-import-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
              <span className="nim-import-option-arrow" aria-hidden="true">›</span>
            </button>)}
          </div>}
        </div>);
  return <section className="nim-manager" aria-label="Painel Comercial">
    {selectedImportMode&&<CommerceImportModal mode={selectedImportMode}
      returnFocusRef={importTriggerRef}
      onClose={()=>setSelectedImportMode(null)}
      onChooseAnother={()=>{setSelectedImportMode(null);setImportMenuOpen(true);}}
      onSalesChanged={()=>setRefresh(v=>v+1)}
      onCatalogChanged={()=>setRefresh(v=>v+1)}/>}
    <CommerceDashboard key={refresh+':'+(perfOpen?perfOpen.nonce:0)} mode="explorer" initialTab={perfOpen?perfOpen.tab:null} actions={importMenu}/>
  </section>;
}
