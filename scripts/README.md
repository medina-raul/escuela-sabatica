# Automatización de recursos

El catálogo `src/data/quarters/2026-q3.json` es la única fuente de verdad para la biblioteca, el sidebar y la automatización.

## Comandos

```bash
npm run resources:update                            # valida y aplica cambios deterministas
npm run resources:update:offline                    # auditoría sin red
npm run resources:audit                             # valida y genera el manifiesto
npm run resources:verify                            # compara el manifiesto con producción
npm run resources:test                              # pruebas de la automatización
```

Los comandos usan `scripts/run_python.mjs`, que selecciona `py -3`/`python` en Windows y `python3`/`python` en macOS o Linux.

En macOS se puede abrir `scripts/run_resource_update.command`. En Windows se puede ejecutar `powershell -ExecutionPolicy Bypass -File scripts/run_resource_update.ps1`. Para completar también las traducciones, el administrador debe ejecutar o programar `/actualizar-recursos-semanales` en Antigravity; el workflow versionado vive en `.agents/workflows/`. Conviene programarlo al menos 45 minutos después del cron de GitHub para que continúe sobre `automation/weekly-resources`.

Los recursos locales con `source.kind: "url"` se descargan primero a un directorio temporal, se validan por tipo real, tamaño y SHA-256, y solo entonces reemplazan los archivos actuales. Si cualquier validación falla, no se actualiza el catálogo y se restauran los archivos afectados.

Los recursos con `source.kind: "manual"` se auditan y reciben checksum, pero no pueden descargarse hasta registrar su URL de origen. Las fuentes permitidas deben estar declaradas en `resourceAutomation.allowedSourceHosts`.

Las presentaciones se descubren en `https://www.fustero.es/`, se descargan primero a una zona temporal y se publican como copias locales únicamente después de validar el contenedor PPTX y su checksum. La aplicación nunca usa Fustero como proxy en tiempo real: el usuario descarga una copia estable servida por Escuela Sabática y el catálogo conserva la atribución de Sergio Fustero y Eunice Laveda.

## Lecturas para maestros

La fuente primaria es el Markdown estructurado de Adventech:

```text
https://raw.githubusercontent.com/Adventech/sabbath-school-lessons/stage/
  src/en/{trimestre}/{lección}/teacher-comments.md
```

El actualizador valida el frontmatter y las secciones `Part I`, `Part II` y `Part III`, calcula el SHA-256 del original y lo compara con el checksum de la fuente que produjo la traducción vigente.

- Los 13 HTML existentes de `2026-q3` se adoptan como traducciones manuales ya revisadas y no se regeneran.
- Si cambia el Markdown, el catálogo queda marcado con `reviewStatus: "source-changed"`, el informe agrega una entrada en `teacherTranslationTasks` y el HTML publicado no se sobrescribe.
- La traducción se realiza después de esa validación mediante el workflow de Antigravity `.agents/workflows/actualizar-recursos-semanales.md` y el Gemini Pro más reciente seleccionado por el administrador.
- `scripts/teacher_translation.py` vuelve a descargar y verificar el original antes de traducir, y luego valida y aplica atómicamente el Markdown español producido por el agente.
- El HTML nuevo queda con `reviewStatus: "pending-review"` dentro del PR semanal.
- El lector del sitio vuelve a sanitizar el HTML antes de insertarlo en el DOM.

No se necesita una clave de API de traducción. Antigravity utiliza el modelo disponible en la sesión del administrador y registra el identificador indicado por el agente.

Flujo interno por tarea:

```bash
npm run resources:teacher -- fetch --lesson 1 --expected-checksum sha256:... --output artifacts/teacher-sources/leccion-01.md
npm run resources:teacher -- apply --lesson 1 --source artifacts/teacher-sources/leccion-01.md --input artifacts/teacher-translations/leccion-01.md --source-checksum sha256:... --model gemini-pro-latest
```

El glosario versionado está en `scripts/teacher_glossary.json`. Cada traducción registra agente, modelo, versión del workflow, versión del renderizador, checksum del original y estado de revisión.

### Política operativa de procedencia

Por decisión del responsable del proyecto, las lecturas se procesan como recursos públicos destinados a difusión evangelizadora, con atribución visible a la Asociación General de los Adventistas del Séptimo Día y a Adventech. Está pendiente archivar una confirmación formal de consentimiento. Esta decisión no elimina la trazabilidad: cada recurso conserva proveedor, URL original, checksum y método de traducción.

`adventech_to_json.py` y `audit_content.py` se conservan para importar y comparar el contenido de las lecciones. No crean ni modifican el catálogo de recursos.
