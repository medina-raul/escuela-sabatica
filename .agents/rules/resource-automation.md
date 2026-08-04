# Reglas para la automatización de recursos

- Lee primero `RESOURCE_AUTOMATION.md`. El catálogo activo indicado por `resource-automation.json` es la única fuente de verdad.
- Ejecuta primero la validación determinista. No traduzcas ni modifiques artículos si el informe contiene errores.
- El motor es neutral respecto del sistema operativo y el agente. Usa `npm run resources:plan` y `npm run resources:sync`; no reproduzcas su lógica manualmente.
- Una persona o el agente disponible puede completar las tareas `teacher-translation` del informe. No llames a una API externa sin autorización expresa.
- Traduce íntegramente, sin resumir, omitir, reinterpretar ni agregar contenido.
- Conserva el frontmatter YAML, Markdown, listas, números, citas bibliográficas y referencias bíblicas.
- Usa obligatoriamente `scripts/teacher_glossary.json` y los tres encabezados canónicos en español.
- Nunca escribas HTML manualmente: entrega Markdown español a `scripts/teacher_translation.py apply`, que genera y valida el HTML seguro.
- Registra el productor y el identificador visible del modelo; usa `unspecified` cuando la herramienta no lo exponga.
- Mantén la atribución configurada en el catálogo y no elimines la URL ni el checksum del original.
- Toda traducción generada queda en `pending-review`; nunca fusiones automáticamente el PR.
- Preserva cambios locales no relacionados y no agregues al commit archivos de `artifacts/`.
