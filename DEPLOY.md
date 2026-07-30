# Deploy a Vercel

## Requisitos previos

- CLI de Vercel instalada: `npm i -g vercel`
- Tener sessión activa: `vercel login`

## Pasos

### 1. Descargar y descomprimir

```bash
# Si descargaste el tar.gz:
tar -xzf n1322y-checklist.tar.gz
cd n1322y-checklist
```

O copia los archivos directamente a `/Users/martinpelaez/Downloads/n1322y-checklist`

### 2. Instalar dependencias

```bash
npm install
```

### 3. Deployar

```bash
vercel deploy --prod
```

Cuando Vercel pregunte:

```
? Set up and deploy "~/path/to/n1322y-checklist"? [Y/n] 
```

Responde `y`. Luego:

```
? Which scope should we deploy to? 
```

Selecciona: **Martin's projects** (team_xmvITYGfbnMsp1Y78E5McLtC)

```
? Link to existing project? [y/N]
```

Responde `n` para crear uno nuevo.

```
? What's your project's name?
```

Escribe: `n1322y-checklist`

```
? In which directory is your code? [./]
```

Presiona Enter (default es ./). El CLI detectará automáticamente `/api`.

### 4. Esperar y confirmar

Vercel creará el proyecto y hará el build. Debería pasar sin errores, aunque los endpoints fallen si falta DATABASE_URL (es normal por ahora).

**Copia la URL** que Vercel te devuelve. Será algo como:
```
https://n1322y-checklist.vercel.app
```

---

## ¿Qué pasa si el build falla?

Verifica:
- ✅ `node_modules` instalado (`npm install`)
- ✅ Node.js v16 o superior (`node --version`)
- ✅ Ningún archivo `.env` en el repo

Si hay error sobre `DATABASE_URL`, es esperado en este punto—una vez que Neon esté conectado desaparecerá.

---

## Próximo paso

Cuando la URL esté lista y el build haya pasado, avísame:
- URL del proyecto (ej: https://n1322y-checklist.vercel.app)

Yo conectaré Neon y Blob, agrego ACCESS_CODE y SESSION_SECRET, y confirmo "listo".
