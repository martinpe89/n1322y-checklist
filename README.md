# N1322Y Checklist Backend

Backend serverless para la app de checklist de la Cessna T182T NAV III, implementado en Vercel + Postgres + Blob Storage.

## Estructura

```
api/
  _lib/
    auth.js         — Funciones de PIN (scrypt) y session (HMAC)
    db.js           — Pool de conexiones a Postgres
    middleware.js   — Verificación de session en endpoints
    response.js     — Utilidades de respuesta HTTP
  session.js        — POST /session: Verificar código, devolver roster
  state.js          — GET /state: Estado actual (roster, tarifa, vuelo abierto)
  flight.js         — POST /flight: Abrir vuelo con lecturas sugeridas
  flight/[id]/check.js   — POST /flight/:id/check: Marcar/desmarcar ítems
  flight/[id]/close.js   — POST /flight/:id/close: Cerrar vuelo
  upload.js         — POST /upload: URLs firmadas para Blob
  report.js         — GET /report?partner=: Vuelos de un socio
  export.js         — GET /export.csv: CSV completo para contabilidad
  partner/[id]/pin.js    — POST /partner/:id/pin: Configurar o cambiar PIN
  migrate.js        — POST /migrate: Inicializar schema (solo dev)

schema.sql          — Migración inicial (partners, flights, checks, settings)
package.json        — Dependencias
.env.example        — Variables necesarias (completa antes de deploy)
```

## Requisitos

1. **Vercel project** existente: `n1322y-checklist` en el equipo `Martin's projects`
2. **Postgres (Neon)**: Conectado al proyecto desde Vercel Marketplace
3. **Blob Storage**: Creado desde Vercel Marketplace
4. **Secretos**: `ACCESS_CODE` y `SESSION_SECRET` en Settings → Environment Variables

## Flujo de autenticación

1. Cliente envía `POST /session` con `code` (el `ACCESS_CODE`)
2. Servidor devuelve `roster` (lista de partners) + token en cookie `httpOnly`
3. Client elige un partner y envía `POST /flight` con `partnerId`
4. Todos los endpoints posteriores verifican el token en la cookie

## Endpoint summary

| Método | Ruta | Qué hace |
|--------|------|----------|
| POST | `/session` | Verificar código, devolver roster |
| GET | `/state` | Roster, tarifa, vuelo abierto, últimas lecturas |
| POST | `/flight` | Abrir vuelo con sugerencias |
| POST | `/flight/:id/check` | Marcar/desmarcar ítem |
| POST | `/flight/:id/close` | Cerrar vuelo |
| POST | `/upload` | URLs para fotos en Blob |
| GET | `/report?partner=` | Vuelos de un partner |
| GET | `/export.csv` | CSV completo |
| POST | `/partner/:id/pin` | Configurar/cambiar PIN |

## Próximos pasos

1. ✅ Estructura y schema
2. ⏳ Endpoints de sesión y roster
3. ⏳ Abrir/cerrar vuelo
4. ⏳ Subida de fotos
5. ⏳ Cola de sincronización en el front
6. ⏳ Reportes
7. Deploy a producción

---

**Esperando instrucciones de Martin para:**
- Neon Postgres (DATABASE_URL)
- Vercel Blob (BLOB_READ_WRITE_TOKEN)
- Variables de entorno (ACCESS_CODE, SESSION_SECRET)
- DNS (checklist.deep.com.co)
