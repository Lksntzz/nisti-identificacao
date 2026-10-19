import React,{useCallback,useEffect,useState} from 'react';
import './operator-pin-gate.css';

// Operator devices use PIN only; no username, e-mail or operator passwords.
export default function OperatorPinGate({children}){
  const [session,setSession]=useState(null);
  const [pin,setPin]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  const check=useCallback(async()=>{
    try{
      const result=await fetch('/api/operator/session',{cache:'no-store',credentials:'same-origin'});
      if(!result.ok)throw Error('A verificação do operador está indisponível.');
      const data=await result.json();
      setSession(data);setError('');
    }catch{
      setSession({required:true,authenticated:false});
      setError('Não foi possível verificar o acesso. Tente novamente.');
    }
  },[]);
  useEffect(()=>{check()},[check]);

  async function login(event){
    event.preventDefault();
    if(!/^\d{8}$/.test(pin)){setError('Digite seu PIN de 8 dígitos.');return}
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/operator/login',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'application/json'},body:JSON.stringify({pin})
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(response.status===429
        ?'Muitas tentativas. Aguarde um minuto.'
        :response.status===401?'PIN inválido.':'Serviço indisponível. Tente novamente.');
      setSession({required:true,authenticated:true,name:data.name});
      setPin('');
    }catch(e){setError(e.message||'Falha na autenticação.')}
    finally{setLoading(false)}
  }
  async function logout(){
    try{
      const response=await fetch('/api/operator/logout',{
        method:'POST',credentials:'same-origin',cache:'no-store'
      });
      if(!response.ok)throw Error('Falha ao encerrar sessão');
      setPin('');setSession({required:true,authenticated:false});
    }catch{setError('Não foi possível encerrar a sessão. Tente novamente.')}
  }

  if(session===null)return <main className="operator-pin-page" role="status">Verificando o acesso ao NISTI…</main>;
  if(!session.required)return children;
  if(session.authenticated)return <>
    {React.cloneElement(children,{pinUser:{name:session.name}})}
    <button type="button" className="operator-pin-logout" onClick={logout}>Sair do operador</button>
  </>;

  return <main className="operator-pin-page">
    <section className="operator-pin-card" aria-label="Acesso do operador">
      <p className="operator-pin-eyebrow">NISTI ID · Operadores</p>
      <h1>Digite seu PIN</h1>
      <p>Acesso ao Scanner e ao Mural com seu código individual.</p>
      <form onSubmit={login}>
        <label htmlFor="operator-pin-input">PIN de 8 dígitos</label>
        <input id="operator-pin-input" type="password" inputMode="numeric" pattern="[0-9]{8}"
          autoComplete="off" minLength={8} maxLength={8} required autoFocus
          value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,8))}
          placeholder="••••••••" aria-describedby={error?'operator-pin-error':undefined}/>
        {error&&<p id="operator-pin-error" className="operator-pin-error" role="alert">{error}</p>}
        <button type="submit" disabled={loading||pin.length!==8}>
          {loading?'Validando PIN…':'Entrar'}
        </button>
      </form>
      <small>Solicite seu PIN individual ao administrador.</small>
      {error&&<button type="button" className="operator-pin-retry" onClick={check}>Tentar conexão novamente</button>}
    </section>
  </main>;
}
