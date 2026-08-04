# Automatización de recursos

El catálogo `src/data/quarters/2026-q3.json` es la única fuente de verdad para la biblioteca, el sidebar y la automatización.

## Comandos

```bash
python3 scripts/update_resources.py                 # simulación con fuentes remotas
python3 scripts/update_resources.py --apply         # actualización atómica
python3 scripts/update_resources.py --offline       # auditoría sin red
python3 scripts/audit_resources.py --write-manifest # valida y genera public/resource-manifest.json
python3 scripts/verify_deployment.py                 # compara el manifiesto con producción
```

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
- Si cambia el Markdown y no hay traductor configurado, el catálogo queda marcado con `reviewStatus: "source-changed"`; el HTML publicado no se sobrescribe.
- Si el traductor está configurado, se genera HTML desde una plantilla con etiquetas controladas, se valida, se reemplaza atómicamente y queda con `reviewStatus: "pending-review"` dentro del PR semanal.
- El lector del sitio vuelve a sanitizar el HTML antes de insertarlo en el DOM.

La traducción automática usa OpenAI Responses por defecto y también acepta una API compatible con Chat Completions cuando se configura una URL alternativa. GitHub debe contener:

| Configuración | Ubicación | Requerida |
|---|---|---|
| `TEACHER_TRANSLATION_API_KEY` | Actions secret | Sí |
| `TEACHER_TRANSLATION_MODEL` | Actions variable | Sí |
| `TEACHER_TRANSLATION_API_URL` | Actions variable | No; por defecto usa `https://api.openai.com/v1/responses` |

También se acepta `OPENAI_API_KEY` al ejecutar el script localmente. El glosario versionado está en `scripts/teacher_glossary.json` y cada traducción registra modelo, versión del prompt, checksum del original y estado de revisión.

### Política operativa de procedencia

Por decisión del responsable del proyecto, las lecturas se procesan como recursos públicos destinados a difusión evangelizadora, con atribución visible a la Asociación General de los Adventistas del Séptimo Día y a Adventech. Está pendiente archivar una confirmación formal de consentimiento. Esta decisión no elimina la trazabilidad: cada recurso conserva proveedor, URL original, checksum y método de traducción.

`adventech_to_json.py` y `audit_content.py` se conservan para importar y comparar el contenido de las lecciones. No crean ni modifican el catálogo de recursos.
