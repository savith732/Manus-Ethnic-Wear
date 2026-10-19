let products=[];let cart=JSON.parse(localStorage.getItem('manuCart')||'[]');
const grid=document.getElementById('productGrid'),cartCount=document.getElementById('cartCount'),cartDrawer=document.getElementById('cartDrawer'),overlay=document.getElementById('overlay'),cartItems=document.getElementById('cartItems'),cartTotal=document.getElementById('cartTotal');
const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(n);

async function loadProducts(){const r=await fetch('/api/products');products=await r.json();renderProducts();renderCart()}
function availableVariants(p){return (p.variants||[]).filter(v=>Number(v.quantity)>0)}
function imageSrc(p){return String(p.image||'').startsWith('http')?p.image:'/assets/'+p.image}
function renderProducts(category='All'){
  const shown=category==='All'?products:products.filter(p=>p.category===category);
  grid.innerHTML=shown.map(p=>{
    const variants=availableVariants(p);
    const soldOut=!variants.length;
    const options=variants.map(v=>`<option value="${v.size}">${v.size} — ${v.quantity} left</option>`).join('');
    return `<article class="product">
      <img src="${imageSrc(p)}" alt="${p.name}">
      <div class="product-info">
        <div class="product-row"><h3>${p.name}</h3><span class="price">${money(p.price)}</span></div>
        <div class="category">${p.category}</div>
        <p class="desc">${p.description||''}</p>
        <div class="stockline">${soldOut?'Sold out':`${p.total_stock} total in stock`}</div>
        <select class="size-select" id="size-${p.id}" ${soldOut?'disabled':''}>${soldOut?'<option>Sold out</option>':options}</select>
        <button class="add" onclick="addToCart(${p.id})" ${soldOut?'disabled':''}>${soldOut?'Sold out':'Add to cart'}</button>
      </div>
    </article>`;
  }).join('')||'<p>No products found.</p>'
}

function saveCart(){localStorage.setItem('manuCart',JSON.stringify(cart));renderCart()}
function addToCart(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  const select=document.getElementById('size-'+id);const size=select?.value;
  const variant=(p.variants||[]).find(v=>v.size===size);
  if(!size||!variant||Number(variant.quantity)<=0)return;
  const i=cart.find(x=>x.id===id&&x.size===size);
  const nextQty=(i?.qty||0)+1;
  if(nextQty>Number(variant.quantity)){alert(`Only ${variant.quantity} available in size ${size}.`);return}
  i?i.qty++:cart.push({id,size,qty:1});saveCart();openCart()
}
function removeItem(id,size){cart=cart.filter(x=>!(x.id===id&&x.size===size));saveCart()}
function changeQty(id,size,delta){
  const p=products.find(x=>x.id===id);const v=(p?.variants||[]).find(x=>x.size===size);const item=cart.find(x=>x.id===id&&x.size===size);
  if(!item||!v)return;
  const next=item.qty+delta;
  if(next<=0){removeItem(id,size);return}
  if(next>Number(v.quantity)){alert(`Only ${v.quantity} available in size ${size}.`);return}
  item.qty=next;saveCart()
}
function renderCart(){
  cart=cart.filter(i=>{
    const p=products.find(p=>p.id===i.id);const v=(p?.variants||[]).find(v=>v.size===i.size);return p&&v&&Number(v.quantity)>0
  });
  cartCount.textContent=cart.reduce((a,i)=>a+i.qty,0);
  cartItems.innerHTML=cart.length?cart.map(i=>{
    const p=products.find(x=>x.id===i.id);
    return `<div class="cart-item"><img src="${imageSrc(p)}"><div><strong>${p.name}</strong><br><small>Size ${i.size} • ${money(p.price)}</small><div class="qty"><button onclick="changeQty(${p.id},'${i.size}',-1)">−</button><span>${i.qty}</span><button onclick="changeQty(${p.id},'${i.size}',1)">+</button></div></div><button onclick="removeItem(${p.id},'${i.size}')">Remove</button></div>`
  }).join(''):'<p>Your cart is empty.</p>';
  cartTotal.textContent=money(cart.reduce((s,i)=>{const p=products.find(x=>x.id===i.id);return s+(p?p.price*i.qty:0)},0))
}
function openCart(){cartDrawer.classList.add('open');overlay.classList.add('show')}function closeCart(){cartDrawer.classList.remove('open');overlay.classList.remove('show')}
document.getElementById('cartBtn').onclick=openCart;document.getElementById('closeCart').onclick=closeCart;overlay.onclick=closeCart;
document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderProducts(b.dataset.category)});
document.getElementById('orderForm').onsubmit=async e=>{
  e.preventDefault();const msg=document.getElementById('orderMsg');if(!cart.length){msg.textContent='Add an item first.';return}
  msg.textContent='Submitting...';const customer=Object.fromEntries(new FormData(e.target).entries());
  const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer,items:cart})});
  const j=await r.json();if(!r.ok){msg.textContent=j.error||'Order failed';await loadProducts();return}
  msg.textContent=`Order placed! ID: ${j.order.id}`;cart=[];saveCart();e.target.reset();await loadProducts()
};
document.getElementById('contactForm').onsubmit=async e=>{e.preventDefault();const msg=document.getElementById('contactMsg');const body=Object.fromEntries(new FormData(e.target).entries());const r=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();msg.textContent=r.ok?'Thanks! Your enquiry has been sent.':j.error;if(r.ok)e.target.reset()};
loadProducts().catch(()=>grid.innerHTML='<p>Could not load products.</p>');