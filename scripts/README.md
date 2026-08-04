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

`adventech_to_json.py` y `audit_content.py` se conservan para importar y comparar el contenido de las lecciones. No crean ni modifican el catálogo de recursos.
