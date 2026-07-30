/* =========================================================================
   N1322Y — capa de sincronización offline (paso 5 del spec)
   Aditiva: no modifica la lógica del checklist ni el bloque PHASES.
   - El front sigue escribiendo en almacenamiento local exactamente como hoy.
   - Cada mutación entra a una cola local con id propio (localStorage).
   - Al recuperar conexión, la cola se vacía contra la API en orden.
   - Durante el vuelo manda lo local; para el histórico manda el servidor.
   - Fotos: comprimidas en local, suben a Blob cuando hay red. Si el cierre
     ocurre sin señal el vuelo queda "pendiente de sincronizar" (pill SYNC).
   - PIN: cada socio registra una clave de 4 dígitos en su primer ingreso;
     el servidor la exige como firma al cerrar cada vuelo.
   ========================================================================= */
(function () {
  "use strict";
  const API = "/api";
  const LS = window.localStorage;
  const QKEY = "t182t.sync.q";        // cola de mutaciones
  const MKEY = "t182t.sync.map";      // id local de vuelo -> id de servidor
  const CKEY = "t182t.sync.closed";   // vuelos ya cerrados / vistos
  const PKEY = "t182t.sync.pending";  // cierres esperando la escritura de fotos
  const DKEY = "t182t.device";        // id de este dispositivo

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
  let pendingClose = lsGet(PKEY, {});
  let roster = null;           // roster del servidor [{id,name,hasPin}]
  let authed = null;           // null = desconocido, true/false
  let flushing = false;
  let prevAct = null;          // snapshot del vuelo activo para diff de checks
  let pinAskedFor = {};        // no repetir el registro en la misma sesión

  const qid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const enq = (op) => { op.qid = qid(); op.ts = Date.now(); queue.push(op); lsSet(QKEY, queue); pill(); flush(); };
  const saveQ = () => { lsSet(QKEY, queue); pill(); };

  /* =======================================================================
     UI — bottom sheets con el mismo lenguaje visual de la app
     ======================================================================= */
  const css = document.createElement("style");
  css.textContent =
    "#syncPill{position:fixed;right:12px;bottom:calc(var(--key,64px) + env(safe-area-inset-bottom) + 14px);" +
    "z-index:55;font-family:var(--mono,monospace);font-size:10.5px;letter-spacing:.14em;padding:8px 13px;" +
    "border-radius:999px;border:1px solid var(--line,#242D39);background:rgba(7,9,12,.94);" +
    "backdrop-filter:blur(8px);color:var(--dim,#77848F);display:none;cursor:pointer;text-transform:uppercase}" +
    ".syncSheet{position:fixed;inset:0;z-index:80;background:rgba(3,5,7,.78);display:flex;align-items:flex-end;justify-content:center}" +
    ".syncSheet .in{background:var(--panel2,#171E27);width:100%;max-width:560px;border-radius:16px 16px 0 0;" +
    "border-top:1px solid var(--line,#242D39);padding:22px 20px calc(env(safe-area-inset-bottom) + 20px);box-sizing:border-box}" +
    "@media(min-width:600px){.syncSheet{align-items:center}.syncSheet .in{border-radius:16px;border:1px solid var(--line,#242D39)}}" +
    ".syncSheet .k{font-family:var(--mono,monospace);font-size:10.5px;letter-spacing:.18em;color:var(--cyan,#39B7F0);" +
    "text-transform:uppercase;margin-bottom:8px}" +
    ".syncSheet h3{margin:0 0 6px;font-size:19px;font-weight:700;color:var(--fg,#E6EDF5);letter-spacing:-.01em}" +
    ".syncSheet p{margin:0 0 16px;font-size:13.5px;color:var(--dim,#77848F);line-height:1.5}" +
    ".syncSheet .err{display:none;color:var(--red,#FF5A52);font-family:var(--mono,monospace);font-size:11.5px;" +
    "letter-spacing:.08em;margin:10px 2px 0;text-transform:uppercase}" +
    ".syncSheet .err.on{display:block}" +
    ".syncIn{width:100%;height:58px;background:#0A0D11;border:1px solid var(--line,#242D39);border-radius:10px;" +
    "color:var(--fg,#E6EDF5);font-family:var(--mono,monospace);font-size:24px;text-align:center;letter-spacing:.5em;" +
    "text-indent:.5em;padding:0;box-sizing:border-box;font-variant-numeric:tabular-nums}" +
    ".syncIn:focus{outline:none;border-color:var(--cyan,#39B7F0)}" +
    ".syncIn.code{letter-spacing:.06em;text-indent:0;font-size:17px;font-family:var(--sans,sans-serif)}" +
    ".syncLbl{display:block;font-family:var(--mono,monospace);font-size:9.5px;letter-spacing:.14em;" +
    "color:var(--dim,#77848F);text-transform:uppercase;margin:14px 0 7px}" +
    ".syncRow{display:flex;gap:10px;margin-top:20px}" +
    ".syncRow button{flex:1;height:52px;border:1px solid var(--line,#242D39);border-radius:10px;background:none;" +
    "color:var(--dim,#77848F);font-family:var(--mono,monospace);font-size:11.5px;letter-spacing:.14em;" +
    "text-transform:uppercase;cursor:pointer}" +
    ".syncRow button.go{flex:1.5;border:0;background:rgba(47,208,123,.16);color:var(--green,#2FD07B)}" +
    ".syncRow button:active{opacity:.75}";
  document.head.appendChild(css);

  const pillEl = document.createElement("button");
  pillEl.id = "syncPill";
  (document.body || document.documentElement).appendChild(pillEl);
  pillEl.onclick = () => {
    if (authed === false && navigator.onLine) return askCode();
    const p = queue.find((o) => o.needPin);
    if (p) return askSign(p);
    flush();
  };

  function pill() {
    const n = queue.length;
    if (authed === false && navigator.onLine) {
      pillEl.textContent = "Conectar"; pillEl.style.display = "block"; pillEl.style.color = "var(--amber,#FFB020)"; return;
    }
    if (!n) { pillEl.style.display = "none"; return; }
    pillEl.style.display = "block";
    const needPin = queue.some((o) => o.needPin);
    if (!navigator.onLine) { pillEl.textContent = "Offline · " + n; pillEl.style.color = "var(--dim,#77848F)"; }
    else if (needPin) { pillEl.textContent = "Firma pendiente"; pillEl.style.color = "var(--amber,#FFB020)"; }
    else { pillEl.textContent = "Sync · " + n; pillEl.style.color = "var(--cyan,#39B7F0)"; }
  }

  let sheetEl = null;
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  function sheet(html) {
    closeSheet();
    sheetEl = document.createElement("div");
    sheetEl.className = "syncSheet";
    sheetEl.innerHTML = '<div class="in">' + html + "</div>";
    sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); });
    document.body.appendChild(sheetEl);
    return sheetEl;
  }
  const digitsOnly = (inp, max) => {
    inp.addEventListener("input", () => {
      const v = inp.value.replace(/\D/g, "").slice(0, max);
      if (v !== inp.value) inp.value = v;
    });
  };

  /* ---------- código de acceso -------------------------------------------- */
  function askCode() {
    const el = sheet(
      '<div class="k">Sincronización · N1322Y</div>' +
      "<h3>Código de acceso</h3>" +
      "<p>Respalda los vuelos en el servidor. La app funciona igual sin él; los datos quedan en este dispositivo.</p>" +
      '<input id="syCode" class="syncIn code" type="password" autocomplete="off" placeholder="Código compartido">' +
      '<div id="syErr" class="err">Código incorrecto</div>' +
      '<div class="syncRow"><button id="syLater">Luego</button><button id="syGo" class="go">Conectar</button></div>'
    );
    el.querySelector("#syLater").onclick = closeSheet;
    const go = async () => {
      const code = el.querySelector("#syCode").value.trim();
      if (!code) return;
      try {
        const r = await fetch(API + "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        if (r.ok) {
          const j = await r.json(); roster = j.roster || roster; authed = true;
          closeSheet(); pill(); flush(); maybeAskPin();
        } else el.querySelector("#syErr").classList.add("on");
      } catch (e) { el.querySelector("#syErr").classList.add("on"); }
    };
    el.querySelector("#syGo").onclick = go;
    el.querySelector("#syCode").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    setTimeout(() => { const i = el.querySelector("#syCode"); if (i) i.focus(); }, 120);
  }

  /* ---------- registro de PIN (primer ingreso) ---------------------------- */
  function askRegisterPin(sp) {
    if (sheetEl) return;
    const el = sheet(
      '<div class="k">Primer ingreso</div>' +
      "<h3>" + sp.name + "</h3>" +
      "<p>Registra tu clave de 4 dígitos. Es tu firma: se pide una sola vez por vuelo, al cerrarlo. No uses una clave de banco o correo.</p>" +
      '<span class="syncLbl">Clave — 4 dígitos</span>' +
      '<input id="syP1" class="syncIn" type="password" inputmode="numeric" autocomplete="off" maxlength="4">' +
      '<span class="syncLbl">Repítela</span>' +
      '<input id="syP2" class="syncIn" type="password" inputmode="numeric" autocomplete="off" maxlength="4">' +
      '<div id="syErr" class="err"></div>' +
      '<div class="syncRow"><button id="syLater">Luego</button><button id="syGo" class="go">Guardar clave</button></div>'
    );
    const p1 = el.querySelector("#syP1"), p2 = el.querySelector("#syP2"), err = el.querySelector("#syErr");
    digitsOnly(p1, 4); digitsOnly(p2, 4);
    p1.addEventListener("input", () => { if (p1.value.length === 4) p2.focus(); });
    el.querySelector("#syLater").onclick = closeSheet;
    el.querySelector("#syGo").onclick = async () => {
      err.classList.remove("on");
      if (!/^\d{4}$/.test(p1.value)) { err.textContent = "La clave debe tener 4 dígitos"; err.classList.add("on"); return p1.focus(); }
      if (p1.value !== p2.value) { err.textContent = "Las claves no coinciden"; err.classList.add("on"); p2.value = ""; return p2.focus(); }
      try {
        const r = await fetch(API + "/partner/" + sp.id + "/pin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPin: p1.value }),
        });
        if (r.ok) { sp.hasPin = true; closeSheet(); }
        else { const j = await r.json().catch(() => ({})); err.textContent = j.error || "No se pudo guardar"; err.classList.add("on"); }
      } catch (e) { err.textContent = "Sin conexión — intenta luego"; err.classList.add("on"); }
    };
    setTimeout(() => p1.focus(), 120);
  }

  function maybeAskPin() {
    try {
      if (!navigator.onLine || authed !== true || !roster) return;
      if (typeof F !== "object" || !F || !F.pilot) return;
      const sp = roster.find((p) => norm(p.name) === norm(F.pilot));
      if (sp && sp.hasPin === false && !pinAskedFor[sp.id]) {
        pinAskedFor[sp.id] = 1;
        askRegisterPin(sp);
      }
    } catch (e) {}
  }

  /* ---------- firma con PIN al cerrar ------------------------------------- */
  function askSign(op) {
    if (sheetEl) return;
    const el = sheet(
      '<div class="k">Firma del vuelo</div>' +
      "<h3>" + (op.pilot || "Piloto") + "</h3>" +
      "<p>El cierre del vuelo genera el cobro de mantenimiento. Confírmalo con tu clave de 4 dígitos.</p>" +
      '<input id="syP" class="syncIn" type="password" inputmode="numeric" autocomplete="off" maxlength="4">' +
      '<div id="syErr" class="err"' + (op.pinError ? ' style="display:block"' : "") + ">" + (op.pinError || "") + "</div>" +
      '<div class="syncRow"><button id="syLater">Luego</button><button id="syGo" class="go">Firmar cierre</button></div>'
    );
    const p = el.querySelector("#syP");
    digitsOnly(p, 4);
    el.querySelector("#syLater").onclick = closeSheet;
    const go = () => {
      if (!/^\d{4}$/.test(p.value)) return p.focus();
      op.pin = p.value; op.needPin = false; op.pinError = null; saveQ();
      closeSheet(); flush();
    };
    el.querySelector("#syGo").onclick = go;
    p.addEventListener("input", () => { if (p.value.length === 4) go(); });
    setTimeout(() => p.focus(), 120);
  }

  /* ---------- resolver partner del servidor por nombre --------------------- */
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  function serverPartner(localPid, pilotName) {
    if (!roster) return null;
    let name = pilotName;
    if (!name && typeof cfg === "object" && cfg && Array.isArray(cfg.partners)) {
      const lp = cfg.partners.find((p) => p.id === localPid);
      if (lp) name = lp.name;
    }
    if (!name) return null;
    const hit = roster.find((p) => norm(p.name) === norm(name));
    return hit ? hit.id : null;
  }

  /* ---------- subir foto a Blob -------------------------------------------- */
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

  /* ---------- vaciar la cola en orden --------------------------------------- */
  // 5xx = transitorio: lanzar para reintentar después; rendirse tras muchos intentos
  function transient(op, r) {
    if (r.status < 500) return false;
    op.tries = (op.tries || 0) + 1;
    if (op.tries <= 10) throw new Error("server " + r.status);
    return true;
  }

  async function flush() {
    if (flushing || !navigator.onLine || !queue.length) { pill(); return; }
    if (authed === false) { pill(); return; }
    flushing = true;
    try {
      if (!roster) {
        const st = await fetch(API + "/state", { headers: { "x-device-id": deviceId } });
        if (st.status === 401) { authed = false; askCode(); return; }
        if (st.ok) { const j = await st.json(); roster = j.roster || null; authed = true; }
      }
      while (queue.length) {
        const op = queue[0];
        let done = false;
        try { done = await run(op); }
        catch (e) { op.tries = (op.tries || 0) + 1; saveQ(); break; }
        if (done === "auth") { authed = false; askCode(); break; }
        if (done === "wait") break;
        queue.shift(); saveQ();
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
      if (transient(op, r)) return true;
      return true;
    }

    if (op.kind === "check") {
      const sid = idMap[op.lid];
      if (!sid) { op.tries = (op.tries || 0) + 1; return op.tries > 8 ? true : "wait"; }
      const r = await fetch(API + "/flight/" + sid + "/check", { method: "POST", headers: hdr, body: JSON.stringify({ phase: op.phase, item: op.item, checked: op.checked }) });
      if (r.status === 401) return "auth";
      if (transient(op, r)) return true;
      return true;
    }

    if (op.kind === "close") {
      const sid = idMap[op.lid];
      if (!sid) { op.tries = (op.tries || 0) + 1; return op.tries > 8 ? true : "wait"; }
      if (closedDone[op.lid]) return true;
      if (op.needPin) { askSign(op); return "wait"; }
      let ps = op.psUrl || null, pe = op.peUrl || null;
      if (!ps || !pe) {
        const d = (await S.get(K.one(op.lid))) || {};
        op.upTries = (op.upTries || 0) + 1;
        if (!ps && d.start && d.start.img) { try { ps = await uploadPhoto(sid, "start", d.start.img); op.psUrl = ps; saveQ(); } catch (e) { if (op.upTries <= 4) throw e; } }
        if (!pe && d.end && d.end.img) { try { pe = await uploadPhoto(sid, "end", d.end.img); op.peUrl = pe; saveQ(); } catch (e) { if (op.upTries <= 4) throw e; } }
      }
      const r = await fetch(API + "/flight/" + sid + "/close", {
        method: "POST", headers: hdr,
        body: JSON.stringify({
          engStart: op.engS ?? null, acStart: op.acS ?? null,
          engEnd: op.engE ?? null, acEnd: op.acE ?? null,
          photoStartUrl: ps, photoEndUrl: pe, pin: op.pin || null, unchecked: op.unchecked || 0,
        }),
      });
      if (r.status === 401) return "auth";
      if (r.ok) { closedDone[op.lid] = 1; lsSet(CKEY, closedDone); return true; }
      if (r.status === 400) {
        const j = await r.json().catch(() => ({}));
        const msg = j.error || "";
        if (/PIN required/i.test(msg)) { op.needPin = true; op.pin = null; saveQ(); askSign(op); return "wait"; }
        if (/Invalid PIN/i.test(msg)) { op.needPin = true; op.pin = null; op.pinError = "Clave incorrecta"; saveQ(); askSign(op); return "wait"; }
        if (/already closed/i.test(msg)) { closedDone[op.lid] = 1; lsSet(CKEY, closedDone); return true; }
        return true; // otra validación definitiva: no bloquear la cola
      }
      if (transient(op, r)) return true;
      return true;
    }

    return true;
  }

  /* ---------- captura de mutaciones: parche sobre S.set / S.del ------------- */
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

  function enqClose(id, meta) {
    if (queue.some((o) => o.kind === "close" && o.lid === id)) return;
    enq(Object.assign({ kind: "close", lid: id }, meta));
  }

  function hook() {
    if (typeof S !== "object" || !S || typeof K !== "object") { setTimeout(hook, 200); return; }
    const oSet = S.set.bind(S), oDel = S.del.bind(S);

    S.set = async function (k, v) {
      const r = await oSet(k, v);
      try {
        if (k === K.act && v) {
          if (!prevAct || prevAct.id !== v.id) {
            enq({ kind: "open", lid: v.id, pid: v.pid, pilot: v.pilot, t0: v.t0 });
            prevAct = JSON.parse(JSON.stringify(v));
            maybeAskPin();
          } else {
            diffChecks(prevAct, v).forEach(enq);
            prevAct = JSON.parse(JSON.stringify(v));
          }
        }
        if (k === K.idx && Array.isArray(v)) {
          v.forEach((f) => {
            if (f && f.id && !closedDone["q:" + f.id]) {
              closedDone["q:" + f.id] = 1; lsSet(CKEY, closedDone);
              if (!idMap[f.id] && !queue.some((o) => o.kind === "open" && o.lid === f.id))
                enq({ kind: "open", lid: f.id, pid: f.pid, pilot: f.pilot, t0: f.date });
              // el cierre espera a que las fotos queden escritas (K.one) para evitar la carrera
              pendingClose[f.id] = { engS: f.engS, acS: f.acS, engE: f.engE, acE: f.acE, unchecked: f.missing || 0, pilot: f.pilot };
              lsSet(PKEY, pendingClose);
            }
          });
        }
        // las fotos del vuelo ya están en disco: ahora sí encolar el cierre
        const m = /^t182t\.flight\.(.+)$/.exec(String(k));
        if (m && pendingClose[m[1]]) {
          const meta = pendingClose[m[1]];
          delete pendingClose[m[1]]; lsSet(PKEY, pendingClose);
          enqClose(m[1], meta);
        }
      } catch (e) {}
      return r;
    };

    S.del = async function (k) {
      try {
        if (k === K.act && prevAct && idMap[prevAct.id] && !closedDone["q:" + prevAct.id] &&
            !queue.some((o) => o.kind === "close" && o.lid === prevAct.id)) {
          // vuelo abortado localmente: cerrar en servidor para no dejarlo bloqueando
          enqClose(prevAct.id, { engS: null, acS: null, engE: null, acE: null, unchecked: 0, pilot: prevAct.pilot });
        }
        if (k === K.act) prevAct = null;
      } catch (e) {}
      return oDel(k);
    };

    // snapshot inicial del vuelo activo, sin generar ops
    S.get(K.act).then((f) => { if (f && !prevAct) prevAct = JSON.parse(JSON.stringify(f)); }).catch(() => {});

    // barrido de arranque: cierres que quedaron esperando fotos en una sesión anterior
    Object.keys(pendingClose).forEach((id) => {
      const meta = pendingClose[id];
      delete pendingClose[id];
      enqClose(id, meta);
    });
    lsSet(PKEY, pendingClose);
  }
  hook();

  /* ---------- disparadores --------------------------------------------------- */
  window.addEventListener("online", () => { pill(); flush(); });
  window.addEventListener("offline", pill);
  setInterval(() => flush(), 25000);
  setTimeout(async () => {
    if (!navigator.onLine) return pill();
    try {
      const r = await fetch(API + "/state", { headers: { "x-device-id": deviceId } });
      if (r.status === 401) { authed = false; pill(); if (queue.length) askCode(); }
      else if (r.ok) { const j = await r.json(); roster = j.roster || null; authed = true; flush(); maybeAskPin(); }
    } catch (e) {}
  }, 1200);
})();
