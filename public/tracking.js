const trackForm=document.getElementById('trackOrderForm');
const trackResult=document.getElementById('trackResult');
const trackMoney=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);
const trackSteps=['new','confirmed','packed','shipped','completed'];
const trackLabels={new:'Placed',confirmed:'Confirmed',packed:'Packed',shipped:'Shipped',completed:'Delivered',cancelled:'Cancelled'};

function renderTracking(order){
  if(order.status==='cancelled'){
    trackResult.innerHTML=`<div class="track-card"><div class="track-top"><div><span class="track-label">Order</span><strong>${order.id}</strong></div><span class="track-status cancelled">Cancelled</span></div><p>This order has been cancelled.</p></div>`;
    return;
  }

  const current=Math.max(0,trackSteps.indexOf(order.status));
  const steps=trackSteps.map((step,i)=>`<div class="track-step ${i<=current?'done':''} ${i===current?'current':''}"><span class="dot">${i<current?'✓':i+1}</span><span>${trackLabels[step]}</span></div>`).join('');
  const items=(order.items||[]).map(i=>`<li><span>${i.product_name} <small>Size ${i.size||'—'} × ${i.qty}</small></span><strong>${trackMoney(Number(i.price)*Number(i.qty))}</strong></li>`).join('');

  trackResult.innerHTML=`<div class="track-card">
    <div class="track-top">
      <div><span class="track-label">Order ID</span><strong>${order.id}</strong><small>${new Date(order.created_at).toLocaleString()}</small></div>
      <span class="track-status">${trackLabels[order.status]||order.status}</span>
    </div>
    <div class="track-progress">${steps}</div>
    <div class="track-summary">
      <div><span class="track-label">Customer</span><strong>${order.customer_name}</strong></div>
      <div><span class="track-label">Order total</span><strong>${trackMoney(order.total)}</strong></div>
    </div>
    <ul class="track-items">${items}</ul>
  </div>`;
}

trackForm?.addEventListener('submit',async e=>{
  e.preventDefault();
  trackResult.innerHTML='<p class="track-message">Checking your order...</p>';
  const data=Object.fromEntries(new FormData(trackForm).entries());
  const params=new URLSearchParams({orderId:data.orderId,contact:data.phone});
  try{
    const r=await fetch('/api/orders/track?'+params.toString());
    const j=await r.json();
    if(!r.ok){trackResult.innerHTML=`<p class="track-error">${j.error||'Order not found.'}</p>`;return}
    renderTracking(j.order);
  }catch{
    trackResult.innerHTML='<p class="track-error">Could not check the order right now. Please try again.</p>';
  }
});