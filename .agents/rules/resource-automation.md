# Reglas para la automatización de recursos

- El catálogo `src/data/quarters/2026-q3.json` es la única fuente de verdad.
- Ejecuta primero la validación determinista. No traduzcas ni modifiques artículos si el informe contiene errores.
- Las traducciones para maestros las realiza el agente de Antigravity con el Gemini Pro más reciente disponible en su sesión. No llames a OpenAI, DeepL ni a otra API externa.
- Traduce íntegramente, sin resumir, omitir, reinterpretar ni agregar contenido.
- Conserva el frontmatter YAML, Markdown, listas, números, citas bibliográficas y referencias bíblicas.
- Usa obligatoriamente `scripts/teacher_glossary.json` y los tres encabezados canónicos en español.
- Nunca escribas HTML manualmente: entrega Markdown español a `scripts/teacher_translation.py apply`, que genera y valida el HTML seguro.
- Registra el identificador visible del modelo utilizado. Si Antigravity solo muestra la familia, usa `gemini-pro-latest`.
- Mantén la atribución configurada en el catálogo y no elimines la URL ni el checksum del original.
- Toda traducción generada queda en `pending-review`; nunca fusiones automáticamente el PR.
- Preserva cambios locales no relacionados y no agregues al commit archivos de `artifacts/`.
