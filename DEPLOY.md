# Deploy — checklist.deep.com.co

Lista de chequeo de despliegue. El proyecto **n1322y-checklist** ya existe en Vercel (equipo *Martin's projects*), con dominio **checklist.deep.com.co** apuntado.

## Prevuelo

- CLI de Vercel: `npm i -g vercel` y `vercel login`
- Integraciones activas en el proyecto (Vercel → Storage):
  - **Neon Postgres** → inyecta `DATABASE_URL` automáticamente
  - **Vercel Blob** → inyecta `BLOB_READ_WRITE_TOKEN` automáticamente
- Variables manuales en Settings → Environment Variables:
  - `ACCESS_CODE` — código compartido de los socios
  - `SESSION_SECRET` — firma HMAC de las sesiones
- **Ningún secreto en el repo.** `.env.example` solo lleva placeholders.

## Rodaje y despegue

```bash
cd n1322y-checklist
npm install          # solo instala pg
vercel deploy --prod
```

Al estar el proyecto vinculado, el CLI despliega directo. `vercel.json` aplica `cleanUrls` y el rewrite `/api/export.csv → /api/export`; el directorio `api/` se detecta solo.

## Primera puesta en marcha (una sola vez)

Con Neon conectado, inicializar el schema y sembrar los socios:

```bash
curl -X POST https://checklist.deep.com.co/api/migrate \
  -H "Content-Type: application/json" \
  -d '{"code":"<ACCESS_CODE>"}'
```

Ejecuta `schema.sql` (idempotente: `create table if not exists`) y crea los socios iniciales.

## Chequeo post-despegue

1. **Sistemas:** `curl https://checklist.deep.com.co/api/health` — las cuatro variables deben reportar `true`.
2. **Enlace de datos:** abrir la app, ingresar el código en la hoja "Conectar" y verificar que el pill de sync desaparece (cola vacía).
3. **Circuito completo:** abrir un vuelo de prueba, marcar ítems, fotografiar los dos tacómetros (el OCR autollena; verificar la lectura), cerrar con PIN y confirmar el vuelo en `GET /api/report?partner=<id>` y en `/api/export.csv`.
4. **Modo offline:** en modo avión, marcar ítems y confirmar el pill `OFFLINE · n`; al volver la señal debe vaciar la cola en orden.

## Anomalías

- **Error de `DATABASE_URL`:** la integración Neon no está conectada al proyecto, o el deploy corrió antes de conectarla. Reconectar y redesplegar.
- **401 en toda la API:** `ACCESS_CODE` o `SESSION_SECRET` faltan o cambiaron (los tokens vigentes quedan inválidos al rotar el secret).
- **Fotos que no suben:** revisar que la integración Blob esté activa; el cliente sube directo a `blob.vercel-storage.com` con el grant de `/api/upload`.
- **Rotación de secretos:** cambiar el valor en Vercel y redesplegar. Nunca escribirlos en archivos del repo.
