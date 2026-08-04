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
  -> auditoría + manifiesto
  -> build
  -> revisión y PR
```

Cada fase determinista puede ejecutarse sin un agente. Los archivos se validan por extensión, estructura real, tamaño y SHA-256 antes de reemplazar el destino. Las operaciones físicas y el catálogo se restauran si falla la auditoría posterior.

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
