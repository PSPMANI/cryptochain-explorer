import{a as A}from"./c-S5LET3PR.js";import{a as Y,c as F}from"./c-UXBIHD4E.js";import"./c-SSVVMCWA.js";import{a as W,b as j,c as q,d as D,f as x,h as O,i as w,k as P,l as U,n as z}from"./c-SGW2I6UA.js";import{a as _,b as M}from"./c-5NBLQJ6V.js";import{a as d,b as o,c as B,d as h,f as R,h as m,j as y,o as T,p as g,q as H,u as i}from"./c-4636X6ZD.js";import{d as N,h as S,k as b}from"./c-XCVHI2IL.js";import"./c-JMHTANIZ.js";import{b as n}from"./c-YTXI2ERG.js";import"./c-RBPBR5HV.js";import"./c-YSC5EBJ6.js";var f=()=>{};async function G($){document.title="My workspace \xB7 CryptChain",T.innerHTML=`
    <div class="page-head">
      <div><h1 class="page-title">\u{1F4CB} My workspace</h1>
        <p class="muted">Your searches, alerts, watched wallets, labels and saved investigations.</p></div>
      <button class="btn ghost small-btn" id="wipe">\u{1F5D1} Clear all my data</button>
    </div>
    <div class="privacy"><span style="font-size:20px">\u{1F512}</span><div><b>Private to you.</b> <span class="muted">Everything on this page is saved only in this browser on this device. CryptChain has no accounts and no server database, so other visitors never see what you search, watch or label.</span></div></div>
    <div class="card">
      <div class="section-head"><h2>\u{1F558} Recent searches</h2><button class="btn ghost small-btn" id="clear-recent">Clear</button></div>
      <div id="recent-list"></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>\u26A1 Flow alerts</h2><div class="row-gap">${F()}<button class="btn ghost small-btn" id="markread">Mark all read</button></div></div>
      <div id="alert-feed" class="alert-list"></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>\u{1F441} Watchlist</h2><span class="muted small">Checked every 30 s while CryptChain is open</span></div>
      <form id="watch-form" class="search"><input name="addr" placeholder="Add a wallet address to watch" autocomplete="off" spellcheck="false">
        <select name="chain" aria-label="Network"></select><input name="label" placeholder="Label (optional)" class="label-in"><button class="btn">Watch</button></form>
      <div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Network</th><th class="r">Balance</th><th></th></tr></thead><tbody id="watch-rows"></tbody></table></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>\u{1F3F7} My labels</h2><span class="muted small">Add one from any address page with \u{1F3F7} Label</span></div>
      <div id="label-list"></div>
    </div>
    <div class="card">
      <div class="section-head"><h2>\u{1F4BE} Saved investigations</h2></div>
      <div id="inv-list"></div>
    </div>`;let E=()=>{let s=[];try{s=JSON.parse(localStorage.getItem("recent")||"[]").filter(a=>n[a.chainId])}catch{}document.getElementById("recent-list").innerHTML=s.length?`<div class="quick">${s.map(a=>`<a href="${d(a.href)}">${m(n[a.chainId])}${d(a.label)}</a>`).join("")}</div>`:'<p class="muted">No searches yet.</p>'};E(),document.getElementById("clear-recent").onclick=()=>{try{localStorage.removeItem("recent")}catch{}E(),i("Recent searches cleared")},document.getElementById("wipe").onclick=()=>{confirm("Delete your searches, watchlist, alerts, labels and saved investigations from this browser?")&&(W(),b([]),window.dispatchEvent(new Event("alerts-changed")),i("All your data was removed from this browser"),G($))},document.getElementById("markread").onclick=()=>{z(),v(),window.dispatchEvent(new Event("alerts-changed"))};let v=()=>{let s=U();document.getElementById("alert-feed").innerHTML=s.length?s.slice(0,60).map(Y).join(""):'<p class="muted">No alerts yet. Watch a wallet and CryptChain will alert you when it sends to an exchange or bridges to another chain.</p>'};v(),window.removeEventListener("alerts-changed",f),f=()=>{$()||v()},window.addEventListener("alerts-changed",f);let l=document.getElementById("watch-form"),r=l.querySelector("select"),u=()=>{let s=A(l.addr.value).filter(a=>a.kind==="address");r.innerHTML=s.length?s.map(a=>`<option value="${a.chainId}">${d(n[a.chainId].name)}</option>`).join(""):'<option value="">Network</option>'};l.addr.addEventListener("input",u),u(),l.addEventListener("submit",async s=>{if(s.preventDefault(),s.stopPropagation(),!r.value)return i("Enter a valid address first");try{let a=await(await g(r.value)).getAddress(l.addr.value.trim());await q(r.value,a.address,l.label.value),i("Added to watchlist"),l.reset(),u(),p()}catch(a){i(a.message||"Address not found")}});let p=async()=>{let s=await j(),a=document.getElementById("watch-rows");a.innerHTML=s.length?s.map(e=>`<tr data-id="${d(e.id)}">
        <td>${y(e.chain_id,"address",e.address,e.label||null)}${e.label?`<div class="muted small mono">${d(o(e.address))}</div>`:""}</td>
        <td>${m(n[e.chain_id])} ${d(n[e.chain_id].name)}</td>
        <td class="r bal">\u2026</td>
        <td class="r"><a class="btn ghost small-btn" href="#/investigate/${e.chain_id}/${encodeURIComponent(e.address)}">Investigate</a>
          <button class="icon-btn" data-remove="${d(e.id)}" title="Remove">\u2715</button></td></tr>`).join(""):'<tr><td colspan="4" class="muted">Nothing watched yet.</td></tr>',a.querySelectorAll("[data-remove]").forEach(e=>e.onclick=async()=>{await D(e.dataset.remove),p()});let t=await _();for(let e of s){let c=a.querySelector(`tr[data-id="${CSS.escape(e.id)}"] .bal`);try{let C=await H((await g(e.chain_id)).getAddress(e.address),15e3),L=M(t,n[e.chain_id]);c&&(c.innerHTML=`${B(C.balance)} ${d(n[e.chain_id].symbol)}<div class="muted small">${L?h(C.balance*L.usd):""}</div>`)}catch{c&&(c.textContent="\u2014")}}};p();let k=async()=>{let s=await w(),a=document.getElementById("label-list");a.innerHTML=s.length?`<div class="table-scroll"><table><thead><tr><th>Address</th><th>Network</th><th>Name</th><th>Type</th><th></th></tr></thead><tbody>
      ${s.map(t=>{let e=t.chain_id==="evm"?"ethereum":t.chain_id;return`<tr><td>${y(e,"address",t.address,o(t.address))}</td>
        <td>${t.chain_id==="evm"?"All EVM networks":n[t.chain_id]?d(n[t.chain_id].name):d(t.chain_id)}</td>
        <td><b>${d(t.name)}</b> ${t.country?S(t.country):""}</td><td class="small">${d(N[t.category]||t.category)}</td>
        <td class="r"><button class="icon-btn" data-dellabel="${d(t.id)}" title="Remove">\u2715</button></td></tr>`}).join("")}</tbody></table></div>`:'<p class="muted">No labels yet. Label your exchange deposit addresses (or any wallet you know) and CryptChain will recognize them everywhere.</p>',a.querySelectorAll("[data-dellabel]").forEach(t=>t.onclick=async()=>{await P(t.dataset.dellabel),b(await w()),k()})};k();let I=async()=>{let s=await x(),a=document.getElementById("inv-list");a.innerHTML=s.length?`<div class="table-scroll"><table><thead><tr><th>Wallet</th><th>Networks</th><th class="r">Received</th><th class="r">Sent</th><th>Saved</th><th></th></tr></thead><tbody>
      ${s.map(t=>`<tr><td class="mono">${d(t.summary&&t.summary.name?t.summary.name:o(t.address))}</td>
        <td>${(t.chain_ids||[]).map(e=>n[e]?m(n[e]):"").join(" ")} <span class="muted small">${(t.chain_ids||[]).length}</span></td>
        <td class="r in">${h(t.summary&&t.summary.inUsd)||"\u2014"}</td><td class="r out">${h(t.summary&&t.summary.outUsd)||"\u2014"}</td>
        <td>${R(Date.parse(t.created_at))}</td>
        <td class="r"><a class="btn ghost small-btn" href="#/investigate/${(t.chain_ids||[]).join(",")}/${encodeURIComponent(t.address)}?depth=${t.params&&t.params.depth||500}&run=1">Open</a>
          <button class="icon-btn" data-del="${d(t.id)}" title="Delete">\u2715</button></td></tr>`).join("")}</tbody></table></div>`:'<p class="muted">No saved investigations yet. Run one from any address page with <b>Investigate</b>.</p>',a.querySelectorAll("[data-del]").forEach(t=>t.onclick=async()=>{await O(t.dataset.del),I()})};I()}export{G as accountPage};
