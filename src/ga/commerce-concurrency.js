// GA-P01 — limite de consultas simultâneas ao banco dentro de UMA operação (uma abertura de tela).
// Sem fila global entre usuários: cada operação cria o seu limitador. As tarefas começam na ordem em que foram pedidas.
export const MAX_PARALLEL_DB=3;

export function makeLimiter(limit=MAX_PARALLEL_DB){
  const max=Number.isInteger(limit)&&limit>=1?limit:1; // inválido nunca vira "sem limite"
  let active=0;const waiting=[];
  const next=()=>{
    if(active>=max||!waiting.length)return;
    active++;
    const {fn,resolve,reject}=waiting.shift();
    Promise.resolve().then(fn).then(resolve,reject).finally(()=>{active--;next();});
  };
  return fn=>new Promise((resolve,reject)=>{waiting.push({fn,resolve,reject});next();});
}
