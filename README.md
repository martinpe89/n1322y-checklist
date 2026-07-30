# N1322Y — Checklist T182T NAV III

Checklist de vuelo para la Cessna T182T NAV III **N1322Y**, con bitácora de horas compartida entre socios. Opera primero en local (funciona sin señal en cabina) y respalda todo en un backend serverless.

- **Producción:** https://checklist.deep.com.co
- **Plataforma:** Vercel (funciones serverless) + Neon Postgres + Vercel Blob

## Cabina de mando (estructura)

```
index.html          — La app completa (base T182T-Checklist.html preservada)
sync.js             — Capa de sincronización offline (aditiva, no toca el checklist)
plane-preview.html  — Vista previa del arte del avión
api/
  _lib/
    auth.js         — PIN (scrypt nativo de Node) y sesión (HMAC-SHA256, 30 días)
    db.js           — Pool de Postgres (NUMERIC → número JS)
    middleware.js   — requireSession: cookie httpOnly o Authorization: Bearer
    response.js     — Respuestas HTTP
  session.js        — POST /api/session
  state.js          — GET /api/state
  flight.js         — POST /api/flight
  flight/[id]/check.js   — POST /api/flight/:id/check
  flight/[id]/close.js   — POST /api/flight/:id/close
  upload.js         — POST /api/upload
  report.js         — GET /api/report?partner=
  export.js         — GET /api/export.csv (rewrite en vercel.json → /api/export)
  partner/[id]/pin.js    — POST /api/partner/:id/pin
  health.js         — GET /api/health
  migrate.js        — POST /api/migrate
schema.sql          — partners, flights, checks, settings
vercel.json         — cleanUrls + rewrite del CSV
package.json        — Una sola dependencia: pg
```

**Regla de vuelo del front:** el bloque `PHASES` de `index.html` es transcripción literal del POH, Sección 4 (Normal Procedures). **No se toca.** Los ítems marcados CUSTOM/PHOTO son adiciones del operador, no del POH.

## Briefing de la app (index.html)

- **Captura de tacómetro — dos fotos por punto:** al abrir y al cerrar el vuelo se fotografían el **ENG HRS del Garmin G1000** y el **tambor TOTAL HOURS (tipo Quartz)**. Las dos imágenes se componen en una sola para el respaldo.
- **OCR con autollenado:** Tesseract.js 5.1.1 se carga perezoso desde cdnjs (y se precarga cuando hay red, para que en cabina funcione sin señal). El Garmin se lee completo; en el tambor el entero lee confiable y la décima (video inverso) no — se autollena el entero y el piloto completa la décima. **La lectura siempre es editable y la verifica el piloto antes de marcar.**
- **Cierre de vuelo:** valida que las horas no retrocedan, calcula horas de motor y de avión, y muestra una página de agradecimiento ("Despegar es opcional. Volver a casa, jamás.") antes de pasar al logbook.
- **Logbook local:** horas por socio, tarifa y reporte por vuelo.

## Enlace de datos (sync.js)

Capa aditiva: el front sigue escribiendo en almacenamiento local y `sync.js` intercepta las mutaciones.

- **Cola local en `localStorage`** con id propio por operación; al recuperar conexión **se vacía contra la API en orden** (abrir → checks → cierre).
- **El cierre espera las fotos:** no se encola hasta que las imágenes del vuelo quedan escritas en disco, evitando la carrera. Las fotos suben a Blob cuando hay red.
- **Firma con PIN:** cada socio registra una clave de 4 dígitos en su primer ingreso; el servidor la exige como firma al cerrar cada vuelo. Si el cierre quedó en cola sin firma, la app la pide al reconectar.
- **Pill indicador** (esquina inferior): `SYNC · n` (vaciando cola), `OFFLINE · n` (sin red), `FIRMA PENDIENTE` (cierre esperando PIN) y `CONECTAR` (falta el código de acceso).
- Errores 5xx se reintentan; sin código, la app opera igual en modo local.

## Autenticación

1. `POST /api/session` con el `ACCESS_CODE` compartido → roster de socios (con `hasPin`) + token HMAC-SHA256 en cookie `httpOnly` (válido 30 días; también se acepta `Authorization: Bearer`).
2. **PIN de firma:** 4 dígitos, hasheado con **`crypto.scryptSync` nativo de Node (N=16384, r=8, p=1)**, salt de 16 bytes, comparación con `timingSafeEqual`. Para cambiarlo se exige el PIN vigente.

## Endpoints

| Método | Ruta | Notas |
|--------|------|-------|
| POST | `/api/session` | Verifica código, devuelve roster con `hasPin` y setea cookie |
| GET | `/api/state` | Protegido. Roster, tarifa/moneda, vuelo abierto del dispositivo, última lectura |
| POST | `/api/flight` | Abre vuelo; **409** si ya hay uno abierto (un solo avión). Sugiere lecturas del vuelo anterior |
| POST | `/api/flight/:id/check` | Marca/desmarca ítem. **Idempotente** (`ON CONFLICT DO NOTHING` / delete) |
| POST | `/api/flight/:id/close` | Acepta `engStart/acStart/engEnd/acEnd`, fotos, `pin`, `unchecked`. Valida no-retroceso, exige PIN si el socio lo tiene, calcula `gap` contra el `eng_end` anterior. Las horas salen de **columnas generadas en la BD** |
| POST | `/api/upload` | Grant de client-upload a Blob (`photoKey` + token); el cliente sube directo |
| GET | `/api/report?partner=` | Vuelos cerrados del socio, con tarifa y totales |
| GET | `/api/export.csv` | CSV completo para contabilidad (rewrite → `/api/export`, con BOM para Excel) |
| POST | `/api/partner/:id/pin` | PIN de 4 dígitos; exige `oldPin` para cambiar |
| GET | `/api/health` | Estado de las variables de entorno |
| POST | `/api/migrate` | Ejecuta `schema.sql` y siembra los socios iniciales. Exige `ACCESS_CODE` |

**Nota de auditoría:** un `gap` positivo al cierre significa que el avión voló horas que nadie registró.

## Variables de entorno

| Variable | Origen |
|----------|--------|
| `DATABASE_URL` | Inyectada automáticamente por la integración **Neon** de Vercel |
| `BLOB_READ_WRITE_TOKEN` | Inyectada automáticamente por la integración **Blob** de Vercel |
| `ACCESS_CODE` | Manual (Settings → Environment Variables) |
| `SESSION_SECRET` | Manual (Settings → Environment Variables) |

Los valores nunca van al repo. Ver `.env.example` y `DEPLOY.md`.
