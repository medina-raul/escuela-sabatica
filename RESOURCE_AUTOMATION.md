# Automatización portátil de recursos

El motor de actualización pertenece al repositorio. No depende del sistema operativo, del editor ni del agente de programación. Requiere Node.js/npm y Python 3.10 o superior; el mismo comando funciona en Windows, macOS y Linux.

## Comandos estables

```text
npm run resources:plan
npm run resources:sync
npm run resources:sync:offline
```

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
  -> revisión y PR
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

## Adaptadores

Los accesos directos `.command` y `.ps1`, GitHub Actions y `.agents/workflows/` son sólo adaptadores del comando estable. Pueden sustituirse sin cambiar el motor ni el catálogo.
