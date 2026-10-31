import{c}from"./c-SSVVMCWA.js";import{a as s,f as a,j as e}from"./c-4636X6ZD.js";import{b as n}from"./c-YTXI2ERG.js";var l={"exchange-deposit":"\u{1F3E6}","exchange-withdrawal":"\u{1F3E6}","exchange-internal":"\u{1F501}",institution:"\u{1F3E2}","bridge-out":"\u{1F309}","bridge-in":"\u{1F309}",exploit:"\u26A0\uFE0F",activity:"\u2022"};function $(i){let t=i.bridge,r=t?`<div class="alert-bridge">
      ${o(t.srcChain)} ${t.srcTx&&n[t.srcChain]?e(t.srcChain,"tx",t.srcTx):""}
      <span class="muted">\u2192</span> ${o(t.dstChain)} ${t.dstTx&&n[t.dstChain]?e(t.dstChain,"tx",t.dstTx):t.dstTx?"":'<span class="chip pend">in flight</span>'}
      ${t.recipient&&n[t.dstChain]?`\xB7 to ${e(t.dstChain,"address",t.recipient,i.entity&&i.entity.category==="exchange"?i.entity.label:null)}`:""}</div>`:"";return`<div class="alert ${s(i.level)} ${i.read===!1?"unread":""}">
    <div class="alert-icon">${l[i.kind]||"\u2022"}</div>
    <div class="grow">
      <div class="alert-title">${s(i.title)}</div>
      <div class="muted small">${s(i.detail||"")}</div>
      ${r}
      <div class="small alert-meta">${i.chainId&&n[i.chainId]?`<span class="dot" style="background:${n[i.chainId].color}"></span> ${s(n[i.chainId].name)} \xB7 `:""}
        ${i.hash&&i.chainId?e(i.chainId,"tx",i.hash)+" \xB7 ":""}${i.address&&i.chainId?"wallet "+e(i.chainId,"address",i.address)+" \xB7 ":""}${a(i.time)}</div>
    </div></div>`}var o=i=>n[i]?`<span class="chip chain" style="--c:${n[i].color}"><span class="dot" style="background:${n[i].color}"></span>${s(n[i].name)}</span>`:`<span class="chip">${s(c(i))}</span>`;function m(){return"Notification"in window?Notification.permission==="granted"?'<span class="chip ok">Notifications on</span>':Notification.permission==="denied"?'<span class="chip" title="Allow notifications for this site in your browser settings">Notifications blocked</span>':`<button class="btn ghost small-btn" onclick="Notification.requestPermission().then(()=>dispatchEvent(new Event('hashchange')))">Enable notifications</button>`:""}export{$ as a,o as b,m as c};
