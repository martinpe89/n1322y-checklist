/* =========================================================================
   N1322Y — capa de sincronización offline (paso 5 del spec)
   Aditiva: no modifica la lógica del checklist ni el bloque PHASES.
   - El front sigue escribiendo en almacenamiento local exactamente como hoy.
   - Cada mutación entra a una cola local con id propio (localStorage).
   - Al recuperar conexión, la cola se vacía contra la API en orden.
   - Durante el vuelo manda lo local; para el histórico manda el servidor.
   - Fotos: comprimidas en local, suben a Blob cuando hay red. Si el cierre
     ocurre sin señal el vuelo queda "pendiente de sincronizar" (pill SYNC).
   ========================================================================= */
(function () {
  "use strict";
  const API = "/api";
  const LS = window.localStorage;
  const QKEY = "t182t.sync.q";       // cola de mutaciones
  const MKEY = "t182t.sync.map";     // id local de vuelo -> id de servidor
  const CKEY = "t182t.sync.closed";  // vuelos ya cerrados en servidor
  const DKEY = "t182t.device";       // id de este dispositivo

  /* ---------- almacenamiento propio de la cola (con fallback en memoria) */
  const mem = {};
  const lsGet = (k, d) => { try { const v = LS.getItem(k); return v == null ? (mem[k] ?? d) : JSON.parse(v); } catch (e) { return mem[k] ?? d; } };
  const lsSet = (k, v) => { mem[k] = v; try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const deviceId = (() => {
    let d = lsGet(DKEY, null);
    if (!d) { d = "dev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); lsSet(DKEY, d); }
    return d;
  })();

  let queue = lsGet(QKEY, []);
  let idMap = lsGet(MKEY, {});
  let closedDone = lsGet(CKEY, {});
  let roster = null;          // roster del servidor [{id,name}]
  let authed = null;          // null = desconocido, true/false
  let flushing = false;
  let prevAct = null;         // snapshot del vuelo activo para diff de checks

  const qid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const enq = (op) => { op.qid = qid(); op.ts = Date.now(); queue.push(op); lsSet(QKEY, queue); pill(); flush(); };
  const saveQ = () => { lsSet(QKEY, queue); pill(); };

  /* ---------- pill de estado (marca "pendiente de sincronizar") ---------- */
  const pillEl = document.createElement("button");
  pillEl.id = "syncPill";
  pillEl.style.cssText = "position:fixed;right:10px;bottom:calc(var(--key,64px) + env(safe-area-inset-bottom) + 16px);" +
    "z-index:55;font-family:var(--mono,monospace);font-size:10px;letter-spacing:.12em;padding:6px 10px;" +
    "border-radius:999px;border:1px solid var(--line,#242D39);background:rgba(7,9,12,.92);color:var(--dim,#77848F);display:none";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(pillEl));
  if (document.body) document.body.appendChild(pillEl);
  pillEl.onclick = () => { if (authed === false) askCode(); else flush(); };

  function pill() {
    const n = queue.length;
    if (authed === false && navigator.onLine) {
      pillEl.textContent = "CÓDIGO"; pillEl.style.display = "block"; pillEl.style.color = "var(--amber,#FFB020)"; return;
    }
    if (!n) { pillEl.style.display = "none"; return; }
    pillEl.style.display = "block";
    if (!navigator.onLine) { pillEl.textContent = "OFFLINE · " + n; pillEl.style.color = "var(--dim,#77848F)"; }
    else { pillEl.textContent = "SYNC · " + n; pillEl.style.color = "var(--cyan,#39B7F0)"; }
  }

  /* ---------- overlay para el código de acceso (solo si hay red y 401) --- */
  let overlay = null;
  function askCode() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:80;background:rgba(3,5,7,.86);display:grid;place-items:center;padding:24px";
    overlay.innerHTML =
      '<div style="width:100%;max-width:340px;background:var(--panel2,#171E27);border:1px solid var(--line,#242D39);border-radius:14px;padding:20px">' +
      '<div style="font-family:var(--mono,monospace);font-size:11px;letter-spacing:.16em;color:var(--dim,#77848F);text-transform:uppercase;margin-bottom:10px">Sincronización N1322Y</div>' +
      '<p style="margin:0 0 14px;font-size:13.5px;color:var(--dim,#77848F);line-height:1.5">Código de acceso para respaldar los vuelos en el servidor. La app funciona igual sin él; los datos quedan en este dispositivo.</p>' +
      '<input id="syncCode" type="password" autocomplete="off" placeholder="Código" style="width:100%;height:50px;background:#0A0D11;border:1px solid var(--line,#242D39);border-radius:9px;color:var(--fg,#E6EDF5);font-size:16px;padding:0 14px;box-sizing:border-box">' +
      '<div id="syncErr" style="display:none;color:var(--red,#FF5A52);font-size:12.5px;margin-top:8px">Código incorrecto.</div>' +
      '<div style="display:flex;gap:10px;margin-top:14px">' +
      '<button id="syncLater" style="flex:1;height:44px;border:1px solid var(--line,#242D39);border-radius:8px;background:none;color:var(--dim,#77848F);font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer">Luego</button>' +
      '<button id="syncGo" style="flex:1.4;height:44px;border:0;border-radius:8px;background:rgba(47,208,123,.16);color:var(--green,#2FD07B);font-family:var(--mono,monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer">Conectar</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); overlay = null; };
    overlay.querySelector("#syncLater").onclick = close;
    overlay.querySelector("#syncGo").onclick = async () => {
      const code = overlay.querySelector("#syncCode").value.trim();
      if (!code) return;
      try {
        const r = await fetch(API + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        if (r.ok) { const j = await r.json(); roster = j.roster || roster; authed = true; close(); pill(); flush(); }
        else overlay.querySelector("#syncErr").style.display = "block";
      } catch (e) { overlay.querySelector("#syncErr").style.display = "block"; }
    };
    setTimeout(() => { const i = overlay && overlay.querySelector("#syncCode"); if (i) i.focus(); }, 80);
  }

  /* ---------- resolver partner del servidor por nombre ------------------- */
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  function serverPartner(localPid, pilotName) {
    if (!roster) return null;
    // primero por nombre del piloto del vuelo; luego por nombre del partner local
    let name = pilotName;
    if (!name && typeof cfg === "object" && cfg && Array.isArray(cfg.partners)) {
      const lp = cfg.partners.find((p) => p.id === localPid);
      if (lp) name = lp.name;
    }
    if (!name) return null;
    const hit = roster.find((p) => norm(p.name) === norm(name));
    return hit ? hit.id : null;
  }

  /* ---------- subir foto a Blob ------------------------------------------ */
  async function uploadPhoto(serverFlightId, type, dataUrl) {
    const r = await fetch(API + "/upload", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flightId: serverFlightId, photoType: type }),
    });
    if (!r.ok) throw new Error("upload-grant " + r.status);
    const { photoKey, blobToken } = await r.json();
    const bin = await (await fetch(dataUrl)).blob();
    const put = await fetch("https://blob.vercel-storage.com/" + photoKey, {
      method: "PUT",
      headers: { authorization: "Bearer " + blobToken, "x-api-version": "7", "x-content-type": "image/jpeg" },
      body: bin,
    });
    if (!put.ok) throw new Error("blob-put " + put.status);
    const j = await put.json();
    return j.url || null;
  }

  /* ---------- vaciar la cola en orden ------------------------------------ */
  async function flush() {
    if (flushing || !navigator.onLine || !queue.length) { pill(); return; }
    if (authed === false) { pill(); return; }
    flushing = true;
    try {
      if (!roster) {
        const st = await fetch(API + "/state");
        if (st.status === 401) { authed = false; askCode(); return; }
        if (st.ok) { const j = await st.json(); roster = j.roster || null; authed = true; }
      }
      while (queue.length) {
        const op = queue[0];
        let done = false;
        try { done = await run(op); }
        catch (e) {
          // error de red o transitorio: reintentar después
          op.tries = (op.tries || 0) + 1;
          saveQ();
          break;
        }
        if (done === "auth") { authed = false; askCode(); break; }
        if (done === "wait") break;         // dependencia aún no resuelta
        queue.shift(); saveQ();             // done === true o drop definitivo
      }
    } finally { flushing = false; pill(); }
  }

  async function run(op) {
    const hdr = { "Content-Type": "application/json", "x-device-id": deviceId };

    if (op.kind === "open") {
      const spid = serverPartner(op.pid, op.pilot);
      if (!spid) { op.tries = (op.tries || 0) + 1; return op.tries > 8 ? true : "wait"; }
      const r = await fetch(API + "/flight", { method: "POST", headers: hdr, body: JSON.stringify({ partnerId: spid }) });
      if (r.status === 401) return "auth";
      if (r.ok) { const j = await r.json(); idMap[op.lid] = j.flightId; lsSet(MKEY, idMap); return true; }
      if (r.status === 409) { const j = await r.json(); if (j.flight) { idMap[op.lid] = j.flight.id; lsSet(MKEY, idMap); } return true; }
      return true; // 4xx definitivo: no bloquear la cola
    }

    if (op.kind === "check") {
      const sid = idMap[op.lid];
      if (!sid) { op.tries = (op.tries || 0) + 1; return op.tries > 8 ? true : "wait"; }
      const r = await fetch(API + "/flight/" + sid + "/check", { method: "POST", headers: hdr, body: JSON.stringify({ phase: op.phase, item: op.item, checked: op.checked }) });
      if (r.status === 401) return "auth";
      return true; // idempotente; 404 u otros: no bloquear
    }

    if (op.kind === "close") {
      const sid = idMap[op.lid];
      if (!sid) { op.tries = (op.tries || 0) + 1; return op.tries > 8 ? true : "wait"; }
      if (closedDone[op.lid]) return true;
      let ps = null, pe = null;
      try {
        const d = (await S.get(K.one(op.lid))) || {};
        op.upTries = (op.upTries || 0) + 1;
        if (d.start && d.start.img) { try { ps = await uploadPhoto(sid, "start", d.start.img); } catch (e) { if (op.upTries <= 4) throw e; } }
        if (d.end && d.end.img) { try { pe = await uploadPhoto(sid, "end", d.end.img); } catch (e) { if (op.upTries <= 4) throw e; } }
      } catch (e) { throw e; }
      const r = await fetch(API + "/flight/" + sid + "/close", {
        method: "POST", headers: hdr,
        body: JSON.stringify({ engEnd: op.engE ?? null, acEnd: op.acE ?? null, photoStartUrl: ps, photoEndUrl: pe, pin: op.pin || null, unchecked: op.unchecked || 0 }),
      });
      if (r.status === 401) return "auth";
      if (r.ok || r.status === 400) { closedDone[op.lid] = 1; lsSet(CKEY, closedDone); return true; }
      return true;
    }

    return true; // op desconocida: descartar
  }

  /* ---------- captura de mutaciones: parche sobre S.set / S.del ---------- */
  function diffChecks(oldF, newF) {
    const ops = [];
    const oc = (oldF && oldF.checks) || {}, nc = (newF && newF.checks) || {};
    const phases = new Set([...Object.keys(oc), ...Object.keys(nc)]);
    phases.forEach((p) => {
      const a = oc[p] || {}, b = nc[p] || {};
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach((i) => {
        const was = !!a[i], is = !!b[i];
        if (was !== is) ops.push({ kind: "check", lid: newF.id, phase: +p, item: +i, checked: is });
      });
    });
    return ops;
  }

  function hook() {
    if (typeof S !== "object" || !S || typeof K !== "object") { setTimeout(hook, 200); return; }
    const oSet = S.set.bind(S), oDel = S.del.bind(S);

    S.set = async function (k, v) {
      const r = await oSet(k, v);
      try {
        if (k === K.act && v) {
          if (!prevAct || prevAct.id !== v.id) enq({ kind: "open", lid: v.id, pid: v.pid, pilot: v.pilot, t0: v.t0 });
          else diffChecks(prevAct, v).forEach(enq);
          prevAct = JSON.parse(JSON.stringify(v));
        }
        if (k === K.idx && Array.isArray(v)) {
          v.forEach((f) => {
            if (f && f.id && !closedDone["q:" + f.id]) {
              closedDone["q:" + f.id] = 1; lsSet(CKEY, closedDone);
              // asegurar open previo por si el vuelo nunca pasó por K.act con red
              if (!idMap[f.id] && !queue.some((o) => o.kind === "open" && o.lid === f.id))
                enq({ kind: "open", lid: f.id, pid: f.pid, pilot: f.pilot, t0: f.date });
              enq({ kind: "close", lid: f.id, engE: f.engE, acE: f.acE, unchecked: f.missing || 0 });
            }
          });
        }
      } catch (e) {}
      return r;
    };

    S.del = async function (k) {
      try {
        if (k === K.act && prevAct && idMap[prevAct.id] && !closedDone["q:" + prevAct.id] &&
            !queue.some((o) => o.kind === "close" && o.lid === prevAct.id)) {
          // vuelo abortado localmente: cerrar en servidor para no dejarlo bloqueando
          enq({ kind: "close", lid: prevAct.id, engE: null, acE: null, unchecked: 0 });
        }
        if (k === K.act) prevAct = null;
      } catch (e) {}
      return oDel(k);
    };

    // snapshot inicial del vuelo activo, sin generar ops
    S.get(K.act).then((f) => { if (f && !prevAct) prevAct = JSON.parse(JSON.stringify(f)); }).catch(() => {});
  }
  hook();

  /* ---------- disparadores ----------------------------------------------- */
  window.addEventListener("online", () => { pill(); flush(); });
  window.addEventListener("offline", pill);
  setInterval(() => flush(), 25000);
  // probe inicial: si hay red y no hay sesión, ofrecer el código sin estorbar
  setTimeout(async () => {
    if (!navigator.onLine) return pill();
    try {
      const r = await fetch(API + "/state");
      if (r.status === 401) { authed = false; pill(); if (queue.length) askCode(); }
      else if (r.ok) { const j = await r.json(); roster = j.roster || null; authed = true; flush(); }
    } catch (e) {}
  }, 1200);
})();
