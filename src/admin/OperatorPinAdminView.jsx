import React,{useCallback,useEffect,useState} from 'react';
import '../operator-pin-admin.css';

async function requestPinApi(path,body){
  const response=await fetch(path,{
    method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:body===undefined?{}:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data?.error||'Não foi possível atualizar o acesso.');
  return data;
}

export default function OperatorPinAdminView(){
  const [data,setData]=useState({operators:[],required:false});
  const [name,setName]=useState('');
  const [once,setOnce]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  const reload=useCallback(async()=>{
    const info=await requestPinApi('/api/admin/operator-pins');
    setData(info);
  },[]);
  useEffect(()=>{reload().catch(()=>setError('Falha ao consultar operadores.'))},[reload]);
  async function action(fn){
    setBusy(true);setError('');setMessage('');
    try{await fn();await reload()}
    catch(e){setError(e.message||'Falha ao salvar alteração.')}
    finally{setBusy(false)}
  }
  async function create(event){
    event.preventDefault();setOnce(null);
    await action(async()=>{
      const result=await requestPinApi('/api/admin/operator-pins',{name:name.trim()});
      setOnce({name:result.operator.name,pin:result.pin});
      setName('');
      setMessage('Operador cadastrado. Copie o PIN agora; ele não poderá ser consultado depois.');
    });
  }
  async function rotate(id,name){
    setOnce(null);
    if(!window.confirm('Substituir o PIN de '+name+'? O PIN antigo e as sessões atuais deixarão de funcionar.'))return;
    await action(async()=>{
      const result=await requestPinApi('/api/admin/operator-pins/'+encodeURIComponent(id)+'/rotate',{});
      setOnce({name,pin:result.pin});setMessage('Novo PIN gerado. Entregue-o somente ao operador.');
    });
  }
  async function toggle(id,enabled){
    setOnce(null);
    await action(async()=>{
      await requestPinApi('/api/admin/operator-pins/'+encodeURIComponent(id)+'/enable',{enabled});
      setMessage(enabled?'Operador autorizado.':'Operador bloqueado; sessões invalidadas.');
    });
  }
  async function activate(){
    const next=!data.required;
    setOnce(null);
    if(!window.confirm(next
      ?'Exigir PIN nos celulares agora? Operadores sem PIN cadastrado perderão o acesso até receber um código.'
      :'Desativar temporariamente a exigência de PIN? Isso reabre o acesso antigo sem identificação individual.'))return;
    await action(async()=>{
      await requestPinApi('/api/admin/operator-pins/enforce',{required:next});
      setMessage(next?'PIN obrigatório ativado para Scanner e Mural.':'Exigência de PIN desativada temporariamente.');
    });
  }
  const active=(data.operators||[]).filter(o=>o.enabled).length;
  return <section className="nisti-pin-admin">
    <header className="nisti-pin-admin-head">
      <div><h2>Segurança dos operadores</h2>
        <p>O operador entra somente com seu PIN individual de 8 dígitos. Sem usuário e sem senha adicional.</p></div>
      <span className={data.required?'nisti-pin-status active':'nisti-pin-status'}>
        {data.required?'PIN obrigatório':'Preparação · PIN ainda não exigido'}</span>
    </header>
    <div className="nisti-pin-activate">
      <div><strong>{active} operadores habilitados</strong>
        <p>Cadastre e entregue os códigos antes de ativar. Os PINs são exibidos uma única vez e não ficam disponíveis para consulta.</p></div>
      <button type="button" disabled={busy||(!data.required&&active===0)} onClick={activate}>
        {data.required?'Desativar exigência de PIN':'Ativar PIN obrigatório'}</button>
    </div>
    <form className="nisti-pin-create" onSubmit={create}>
      <label htmlFor="nisti-new-operator">Nome do operador ou setor</label>
      <div><input id="nisti-new-operator" value={name} minLength={2} maxLength={80}
        onChange={e=>setName(e.target.value)} placeholder="Ex.: Operador Expedição" required/>
        <button type="submit" disabled={busy||name.trim().length<2}>Gerar PIN seguro</button></div>
    </form>
    {once&&<div className="nisti-pin-one-time" role="status">
      <strong>PIN gerado para {once.name}</strong>
      <p className="nisti-pin-digits">{once.pin}</p>
      <p>Entregue este código em particular. Ao sair desta tela, ele não poderá ser recuperado.</p>
      <button type="button" onClick={()=>navigator.clipboard?.writeText(once.pin)}>Copiar PIN</button>
      <button type="button" onClick={()=>setOnce(null)}>Ocultar PIN</button>
    </div>}
    {error&&<p className="nisti-pin-error" role="alert">{error}</p>}
    {message&&<p className="nisti-pin-message" role="status">{message}</p>}
    <div className="nisti-pin-accounts">
      <h3>Operadores cadastrados</h3>
      {(data.operators||[]).length===0?<p>Nenhum PIN foi gerado.</p>:
        <div className="nisti-pin-list">{data.operators.map(o=>
          <div className="nisti-pin-item" key={o.id}>
            <div><strong>{o.name}</strong><small>{o.enabled?'Habilitado':'Bloqueado'}</small></div>
            <div>
              {o.enabled&&<button disabled={busy} onClick={()=>rotate(o.id,o.name)}>Novo PIN</button>}
              <button disabled={busy} onClick={()=>toggle(o.id,!o.enabled)}>
                {o.enabled?'Bloquear':'Habilitar'}</button>
            </div>
          </div>
        )}</div>}
    </div>
  </section>;
}
