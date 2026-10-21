import React, { useEffect, useState } from 'react';
import '../mural-admin.css';
import MuralPublicationsDashboard from './MuralPublicationsDashboard.jsx';
import MuralProductImageManager from './MuralProductImageManager.jsx';
import { AdminMuralIcon, request } from './MuralPublishShared.jsx';
import { PostEditor, CollectionEditor } from './MuralPublishWorkspace.jsx';

export default function MuralNistiAdminView({ activeSection = 'dashboard', onSectionChange }) {
  const section = activeSection;
  const [posts,setPosts]=useState([]);
  const [collections,setCollections]=useState([]);
  const [products,setProducts]=useState([]);
  const [editor,setEditor]=useState(null);
  const [collectionEditor,setCollectionEditor]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [metrics,setMetrics]=useState(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [p,c,prod,m]=await Promise.all([
        request('/api/admin/mural/posts'),
        request('/api/admin/mural/collections'),
        request('/api/admin/mural/products?limit=500'),
        request('/api/admin/mural/metrics')
      ]);
      setPosts(p.items||[]);setCollections(c.items||[]);setProducts(prod.items||[]);setMetrics(m||null);
    }catch(err){setError(err.message)}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const action=async(id,name)=>{
    try{setError('');await request(`/api/admin/mural/posts/${id}/${name}`,{method:'POST'});await load()}catch(err){setError(err.message)}
  };
  const sendPush=async row=>{
    if(!window.confirm(`Enviar notificação deste conteúdo para os dispositivos inscritos?\n\n${row.title}`))return;
    try{setError('');const result=await request(`/api/admin/mural/posts/${row.id}/push`,{method:'POST'});window.alert(`Notificação processada: ${result.sent||0} enviada(s), ${result.failed||0} falha(s).`)}catch(err){setError(err.message)}
  };

  const deletePost=async row=>{
    const confirmed=window.confirm(`Apagar esta publicação permanentemente?\n\n${row.title}\n\nEssa ação não pode ser desfeita.`);
    if(!confirmed)return;
    try{
      setError('');
      await request(`/api/admin/mural/posts/${row.id}`,{method:'DELETE'});
      await load();
    }catch(err){
      setError(err.message);
    }
  };

  const openPublicationEditor=row=>{
    if(row?.kind==='collection'){
      const linked=collections.find(collection=>Number(collection.id)===Number(row.collection_id));
      if(linked){
        setCollectionEditor(linked);
        return;
      }
      setError('A publicação aponta para uma coleção que não existe mais. A coleção vinculada não existe mais. Crie ou publique novamente pela ferramenta Publicar.');
      return;
    }
    setEditor(row);
  };

  const sectionMeta = {
    dashboard:{title:'Painel',description:'Visualize e gerencie as publicações já feitas no Mural.',icon:'document',eyebrow:'MURAL NISTI'},
    publish:{title:'Publicar',description:'Crie uma nova publicação de Produto, Informação ou Coleção.',icon:'sparkles',eyebrow:'MURAL NISTI'},
    treatment:{title:'Tratamento',description:'Trate, revise e aprove as imagens dos produtos usadas no Mural.',icon:'image',eyebrow:'PRODUÇÃO VISUAL'},
  };
  const currentSection = sectionMeta[section] || sectionMeta.dashboard;

  if (collectionEditor) {
    return <CollectionEditor
      item={collectionEditor.mode==='new'?null:collectionEditor}
      products={products}
      onClose={()=>setCollectionEditor(null)}
      onSaved={load}
      onOpenExistingCollection={async slug => {
        try {
          const result = await request('/api/admin/mural/collections');
          const existing = (result?.items || []).find(row => row.slug === slug);
          if (!existing) { setError('A coleção existente não foi encontrada na listagem. Atualize o painel.'); return; }
          setCollectionEditor(existing);
        } catch (err) { setError(err.message); }
      }}
      onSwitchKind={kind=>{setCollectionEditor(null);setEditor({mode:'new',kind})}}
    />;
  }

  if (editor) {
    return <PostEditor
      item={editor}
      onClose={()=>setEditor(null)}
      onSaved={load}
      onCreateCollection={()=>{setEditor(null);setCollectionEditor({mode:'new'})}}
    />;
  }

  if (section === 'publish') {
    return <PostEditor
      item={{mode:'new'}}
      onClose={()=>onSectionChange?.('dashboard')}
      onSaved={load}
      onOpenExistingCollection={async slug => {
        try {
          const result = await request('/api/admin/mural/collections');
          const existing = (result?.items || []).find(row => row.slug === slug);
          if (!existing) { setError('A coleção existente não foi encontrada.'); return; }
          setEditor(null);
          setCollectionEditor(existing);
        } catch (err) { setError(err.message); }
      }}
      onCreateCollection={()=>setCollectionEditor({mode:'new'})}
    />;
  }

  return <section className="mural-admin-view mural-admin-dashboard">
    <header className="mural-admin-dashboard-header mural-admin-dashboard-header-hierarchy">
      <div className="mural-admin-dashboard-title">
        <span className="icon"><AdminMuralIcon name={currentSection.icon} size={22}/></span>
        <span><small className="mural-admin-section-eyebrow">{currentSection.eyebrow}</small><h2>{currentSection.title}</h2><p>{currentSection.description}</p></span>
      </div>
      <div className="mural-admin-dashboard-actions">
        <button type="button" className="qa" onClick={()=>window.location.assign('/admin?mural=qa#admin/mural-nisti')}>Área de teste</button>
      </div>
    </header>

    <div className="mural-admin-workspace mural-admin-workspace-single">
      <main className="mural-admin-workspace-content">
        {error&&<div className="mural-admin-error">{error}</div>}

        {section==='dashboard'&&<MuralPublicationsDashboard
          posts={posts}
          collections={collections}
          loading={loading}
          metrics={metrics}
          onEdit={openPublicationEditor}
          onAction={action}
          onPush={sendPush}
          onDelete={deletePost}
        />}

        {section==='treatment'&&<MuralProductImageManager products={products} onChanged={load} request={request}/>}

      </main>
    </div>

  </section>;
}
