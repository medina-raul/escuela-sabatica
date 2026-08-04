# Automatización integral y portátil del sitio

El motor de actualización pertenece al repositorio. No depende del sistema operativo, del editor ni del agente de programación. La operación cotidiana está pensada para una persona no técnica: un doble clic comprueba la copia local, instala dependencias, actualiza recursos, publica el cambio mediante PR, sincroniza producción y verifica el despliegue.

## Operación para el editor

- Windows: doble clic en `ACTUALIZAR_SITIO_WINDOWS.cmd`.
- macOS: doble clic en `ACTUALIZAR_SITIO_MAC.command`.
- Sin intervención: GitHub Actions ejecuta el mismo ciclo cada lunes a las 11:17 UTC.

La primera ejecución puede instalar Git, Node.js, Python y GitHub CLI mediante `winget` en Windows o Homebrew en macOS. También abre una autorización de GitHub en el navegador una sola vez. En ejecuciones posteriores, `npm ci` instala o ajusta automáticamente las librerías exactas declaradas por el proyecto.

El orquestador integral es `scripts/site_maintenance.py` y su configuración estable está en `site-maintenance.json`.

## Ciclo integral

```text
bloqueo de concurrencia
  -> diagnóstico de herramientas y autenticación
  -> repositorio limpio + fast-forward desde medina-raul/main
  -> npm ci
  -> planificación remota sin aplicar
  -> reestructuración + bandeja manual + fuentes
  -> checksums + auditoría + pruebas + build + rutas
  -> commit limitado a rutas de recursos
  -> rama automática + PR
  -> comprobaciones remotas + squash merge
  -> fast-forward de la copia local
  -> espera de Vercel + verificación de producción
```

El sistema nunca usa `git reset`, `git add -A`, rebase automático ni push forzado a `main`. Si encuentra cambios locales, commits divergentes, rutas inesperadas, tareas no deterministas o comprobaciones fallidas, se detiene sin sobrescribir trabajo y genera `artifacts/site-maintenance-report.json`.

Las tareas asistidas —actualmente traducciones nuevas para maestros— producen un PR borrador y requieren un agente compatible antes de fusionarse. Todo lo determinista es completamente desatendido.

## Comandos estables

```text
npm run site:update
npm run site:update:plan
npm run site:update:local
npm run resources:plan
npm run resources:sync
npm run resources:sync:offline
```

- `site:update` ejecuta el ciclo completo, incluyendo GitHub, despliegue y resincronización local.
- `site:update:plan` prueba localmente el descubrimiento sin aplicar ni publicar.
- `site:update:local` ejecuta el motor completo de recursos sin GitHub ni despliegue.
- `resources:plan` calcula la reestructuración, los ingresos manuales, las actualizaciones remotas y las tareas asistidas sin modificar archivos.
- `resources:sync` reestructura, importa, descarga, valida, reemplaza atómicamente, audita y compila.
- `resources:sync:offline` ejecuta el mantenimiento físico y manual sin consultar Internet.

El catálogo activo se define en `resource-automation.json`. El catálogo contiene las fuentes permitidas, las reglas de descubrimiento y la disposición física canónica. Cambiar de trimestre no requiere modificar los scripts.

## Fases

```text
catálogo activo
  -> reestructuración canónica
  -> bandeja manual
  -> fuentes remotas
  -> tareas asistidas
  -> auditoría + manifiesto + inventario de estado
  -> pruebas automatizadas
  -> build
  -> auditoría de rutas del sitio construido
  -> publicación, despliegue y verificación
```

Cada fase determinista puede ejecutarse sin un agente. Los archivos se validan por extensión, estructura real, tamaño y SHA-256 antes de reemplazar el destino. Las operaciones físicas y el catálogo se restauran si falla la auditoría posterior. El comando estable ejecuta además toda la batería de pruebas antes del build, tanto desde el acceso directo local como desde GitHub Actions.

Cada ejecución aplicada genera además `artifacts/resource-status.json`, con el estado, almacenamiento y origen de todos los recursos catalogados.

Después del build, `audit_site_build.py` recorre todas las páginas HTML generadas y comprueba sus referencias locales (`href`, `src`, `srcset` y `poster`). Una ruta, imagen, script, hoja de estilo o descarga inexistente detiene la ejecución antes del PR.

## Asociación automática de los viernes

Cuando existe un recurso con rol `friday-reading`, la primera frase completa del contenido del viernes de esa lección se transforma automáticamente en el disparador del modal. La asociación se realiza por `lessonNumber`, por lo que no depende del título, del libro citado ni de una expresión textual específica.

La auditoría exige que todo recurso de viernes tenga un día viernes y que su primer bloque comience con una invitación completa a leer. Así se evita que una lectura aparezca en la biblioteca o en la barra lateral pero quede desconectada del texto principal.

## Recursos manuales

La bandeja está en `resource-inbox/<quarterId>/` y replica la estructura debajo de `public/recursos/<quarterId>/`. Un archivo que actualiza un recurso `source.kind: manual` existente no necesita descriptor. Un recurso nuevo requiere el descriptor `<archivo>.resource.json`; consulta `resource-inbox/README.md`.

La bandeja nunca puede sobrescribir un recurso cuya autoridad sea una URL remota.

## Tareas asistidas

El informe `artifacts/resource-sync-report.json` incluye `tasks`. Actualmente `teacher-translation` es la única tarea no determinista. Puede resolverla una persona, Codex, Antigravity, Gemini, Copilot u otro agente capaz de leer y escribir archivos.

El productor debe:

1. Trabajar exclusivamente con las tareas del informe.
2. Obtener el original mediante `npm run resources:teacher -- fetch ...`.
3. Traducir todo el Markdown usando `scripts/teacher_glossary.json`.
4. Aplicarlo mediante `npm run resources:teacher -- apply ... --producer <nombre> --model <modelo>`.
5. Ejecutar nuevamente `npm run resources:audit` y `npm run build`.

El script de aplicación vuelve a comprobar el checksum de la fuente, valida ambos idiomas, genera HTML seguro y deja el resultado pendiente de revisión. El agente no debe editar directamente el HTML ni fusionar automáticamente el PR.

## Publicación semanal

`.github/workflows/weekly-resources.yml` ejecuta la actualización en un runner limpio, publica sólo las rutas autorizadas, crea y fusiona el PR cuando no existen tareas asistidas y comprueba `https://escuelasabatica.cl`. Para una ejecución semanal sin aprobaciones manuales se configura una sola vez el secreto `AUTOMATION_GITHUB_TOKEN` con un token de la cuenta administradora y permisos de contenido, PR e incidencias. El token estándar queda como respaldo, pero GitHub puede exigir aprobar manualmente los workflows que ese mismo token genera.

Los PR de recursos ejecutan además `.github/workflows/resource-pr-validation.yml`.

## Adaptadores

Los accesos directos `.cmd`, `.command` y `.ps1`, GitHub Actions y `.agents/workflows/` son adaptadores. Pueden sustituirse sin cambiar el motor, el catálogo ni las reglas de seguridad.
