import React,{useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import CommerceImportCenter from './commerce-import-center.jsx';
import {COMMERCE_IMPORT_OPTIONS} from './commerce-import-options.js';
import CommercialIcon from './vendor/CommercialIcon.jsx';
import './commerce-import-modal.css';

// Shared import workspace. Only the input/validation flow changes by report type.
// Uses a portal so admin-panel stacking contexts cannot cover or crop the dialog.
export default function CommerceImportModal({mode,onClose,onChooseAnother,onSalesChanged,onCatalogChanged}){
  const dialogRef=useRef(null);
  const choice=COMMERCE_IMPORT_OPTIONS.find(option=>option.mode===mode);
  useEffect(()=>{
    if(!choice)return;
    const before=document.activeElement;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const dialog=dialogRef.current;
    dialog?.focus();
    function onKeyDown(event){
      if(event.key==='Escape'){
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if(event.key!=='Tab'||!dialog)return;
      const all=[...dialog.querySelectorAll(
        'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )].filter(node=>node.getClientRects().length>0);
      if(all.length===0){event.preventDefault();dialog.focus();return;}
      const first=all[0],last=all[all.length-1];
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){
        event.preventDefault();first.focus();
      }
    }
    document.addEventListener('keydown',onKeyDown,true);
    return ()=>{
      document.removeEventListener('keydown',onKeyDown,true);
      document.body.style.overflow=previousOverflow;
      if(before&&typeof before.focus==='function'&&before.isConnected)before.focus();
    };
  },[mode,onClose,choice?.mode]);
  if(!choice||typeof document==='undefined')return null;
  return createPortal(
    <div className="nim-import-overlay">
      <div className="nim-import-dialog" role="dialog" aria-modal="true"
        aria-labelledby="nim-import-dialog-title" aria-describedby="nim-import-dialog-subtitle"
        tabIndex={-1} ref={dialogRef}>
        <header className="nim-import-dialog-header">
          <div className="nim-import-dialog-icon" aria-hidden="true">
            <CommercialIcon name={choice.icon} size={22}/>
          </div>
          <div className="nim-import-dialog-heading">
            <span>Central de Importações <span className="nim-import-dialog-divider">/</span> {choice.label}</span>
            <h2 id="nim-import-dialog-title">Importar arquivo</h2>
            <p id="nim-import-dialog-subtitle">{choice.description}</p>
          </div>
          <button type="button" className="nim-import-dialog-close" onClick={onClose}
            aria-label="Fechar janela de importação">×</button>
        </header>
        <div className="nim-import-dialog-subhead">
          <div><strong>Tipo selecionado:</strong> {choice.fileType}</div>
          <button type="button" onClick={onChooseAnother}>
            <CommercialIcon name="chevron-left" size={14}/> Alterar tipo
          </button>
        </div>
        <main className="nim-import-dialog-body">
          <CommerceImportCenter key={mode} embedded initialMode={mode} hideModeSelector
            onSalesChanged={onSalesChanged} onCatalogChanged={onCatalogChanged}/>
        </main>
        <footer className="nim-import-dialog-footer">
          <span>Os relatórios são validados antes da importação. As informações existentes são preservadas.</span>
          <button type="button" onClick={onClose}>Fechar</button>
        </footer>
      </div>
    </div>,document.body
  );
}
