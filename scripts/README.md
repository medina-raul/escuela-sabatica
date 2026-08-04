# Automatización de recursos

El catálogo indicado por `resource-automation.json` es la única fuente de verdad para la biblioteca, el sidebar y la automatización. La explicación independiente de plataforma está en `RESOURCE_AUTOMATION.md`.

## Comandos

```bash
npm run resources:plan                              # previsualiza todas las fases
npm run resources:sync                              # reestructura, actualiza, audita, prueba y compila
npm run resources:sync:offline                      # igual, sin consultar fuentes remotas
npm run resources:restructure                       # sólo normaliza la estructura física
npm run resources:manual                            # sólo procesa resource-inbox
npm run resources:status                            # inventario completo de estado y origen
npm run resources:site-audit                        # revisa rutas locales del build estático
npm run resources:update                            # valida y aplica cambios deterministas
npm run resources:audit                             # valida y genera el manifiesto
npm run resources:verify                            # compara el manifiesto con producción
npm run resources:test                              # pruebas de la automatización
```

Los comandos usan `scripts/run_python.mjs`, que selecciona `py -3`/`python` en Windows y `python3`/`python` en macOS o Linux.

En macOS se puede abrir `scripts/run_resource_update.command`. En Windows se puede ejecutar `powershell -ExecutionPolicy Bypass -File scripts/run_resource_update.ps1`. Ambos llaman exactamente al mismo `resources:sync`; los accesos directos no contienen lógica propia.

Los recursos locales con `source.kind: "url"` se descargan primero a un directorio temporal, se validan por tipo real, tamaño y SHA-256, y solo entonces reemplazan los archivos actuales. Si cualquier validación falla, no se actualiza el catálogo y se restauran los archivos afectados.

Los recursos con `source.kind: "manual"` se reciben en `resource-inbox/<quarterId>/`. La bandeja replica la estructura canónica, valida los archivos y actualiza catálogo y manifiesto de forma atómica. Un recurso nuevo necesita el descriptor `<archivo>.resource.json`.

Antes de importar o descargar, `restructure_resources.py` compara cada recurso local con `resourceAutomation.canonicalLayout`. Puede corregir una URL antigua, mover un archivo legado inequívoco y eliminar un duplicado idéntico. Si encuentra dos candidatos o contenidos distintos, se detiene y no decide por aproximación.

Para toda lección que tenga `friday-reading`, el lector convierte el primer bloque completo del viernes en un enlace al modal. La auditoría comprueba la existencia de esa invitación, y `resource_status.py` registra si la asociación está activa.

Las presentaciones se descubren en `https://www.fustero.es/`, se descargan primero a una zona temporal y se publican como copias locales únicamente después de validar el contenedor PPTX y su checksum. La aplicación nunca usa Fustero como proxy en tiempo real: el usuario descarga una copia estable servida por Escuela Sabática y el catálogo conserva la atribución de Sergio Fustero y Eunice Laveda.

## Lecturas para maestros

La fuente primaria es el Markdown estructurado de Adventech:

```text
https://raw.githubusercontent.com/Adventech/sabbath-school-lessons/stage/
  src/en/{trimestre}/{lección}/teacher-comments.md
```

El actualizador valida el frontmatter y las secciones `Part I`, `Part II` y `Part III`, calcula el SHA-256 del original y lo compara con el checksum de la fuente que produjo la traducción vigente.

- Los 13 HTML existentes de `2026-q3` se adoptan como traducciones manuales ya revisadas y no se regeneran.
- Si cambia el Markdown, el catálogo queda marcado con `reviewStatus: "source-changed"`, el informe agrega una tarea `teacher-translation` y el HTML publicado no se sobrescribe.
- La traducción se realiza después de esa validación por una persona o cualquier agente. `.agents/workflows/` es solamente un adaptador opcional para Antigravity.
- `scripts/teacher_translation.py` vuelve a descargar y verificar el original y luego valida y aplica atómicamente el Markdown español recibido.
- El HTML nuevo queda con `reviewStatus: "pending-review"` dentro del PR semanal.
- El lector del sitio vuelve a sanitizar el HTML antes de insertarlo en el DOM.

No se necesita una clave de API de traducción. El productor y el modelo se registran como procedencia, pero no forman parte del motor.

Flujo interno por tarea:

```bash
npm run resources:teacher -- fetch --lesson 1 --expected-checksum sha256:... --output artifacts/teacher-sources/leccion-01.md
npm run resources:teacher -- apply --lesson 1 --source artifacts/teacher-sources/leccion-01.md --input artifacts/teacher-translations/leccion-01.md --source-checksum sha256:... --producer "nombre" --model "modelo"
```

El glosario versionado está en `scripts/teacher_glossary.json`. Cada traducción registra productor, modelo, versión del contrato, versión del renderizador, checksum del original y estado de revisión.

### Política operativa de procedencia

Por decisión del responsable del proyecto, las lecturas se procesan como recursos públicos destinados a difusión evangelizadora, con atribución visible a la Asociación General de los Adventistas del Séptimo Día y a Adventech. Está pendiente archivar una confirmación formal de consentimiento. Esta decisión no elimina la trazabilidad: cada recurso conserva proveedor, URL original, checksum y método de traducción.

`adventech_to_json.py` y `audit_content.py` se conservan para importar y comparar el contenido de las lecciones. No crean ni modifican el catálogo de recursos.
