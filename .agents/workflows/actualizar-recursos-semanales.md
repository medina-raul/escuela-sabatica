# Actualizar recursos semanales

Este archivo adapta el contrato portátil de `RESOURCE_AUTOMATION.md` a Antigravity. El mismo trabajo puede realizarlo cualquier otro agente o una persona y no requiere una API de traducción.

## 1. Preparación segura

1. Lee `AGENTS.md`, `RESOURCE_AUTOMATION.md`, `.agents/rules/resource-automation.md` y `scripts/README.md`.
2. Ejecuta `git status --short --branch`. Conserva cualquier cambio no relacionado y no cambies de rama si eso pudiera sobrescribir trabajo local.
3. Este workflow se ejecuta después del validador de GitHub. Si existe `origin/automation/weekly-resources` y el árbol está limpio, cambia a esa rama y actualízala exclusivamente con avance rápido. Si no existe, crea `automation/weekly-resources` desde `main`. Nunca uses `reset --hard` ni descartes cambios.
4. Confirma el productor y el identificador del modelo activo. Si la interfaz no expone el modelo, usa `unspecified`.
5. Ejecuta `npm ci` solamente si faltan dependencias; luego ejecuta `npm run resources:test`.

## 2. Validación y detección

1. Crea el directorio local ignorado `artifacts` si no existe.
2. Ejecuta:

   ```text
   npm run resources:sync -- --skip-build --report artifacts/resource-sync-report.json
   ```

3. Lee completamente `artifacts/resource-sync-report.json`.
4. Si `errors` no está vacío, detente sin traducir ni reemplazar archivos y comunica cada error.
5. Las entradas de `tasks` con `kind: "teacher-translation"` son las únicas lecturas para maestros autorizadas para esta ejecución.

## 3. Traducción asistida

Para cada tarea `teacher-translation`, en orden de `lessonNumber`:

1. Copia exactamente `lessonNumber` y `sourceChecksum` desde el informe.
2. Obtén nuevamente el original validado:

   ```text
   npm run resources:teacher -- fetch --lesson LECCION --expected-checksum CHECKSUM --output artifacts/teacher-sources/leccion-NN.md
   ```

3. Lee completamente el archivo inglés y `scripts/teacher_glossary.json`.
4. Traduce todo al español latinoamericano formal y natural. No resumas, omitas ni agregues contenido. Conserva el frontmatter, Markdown, listas, cifras, citas y referencias bíblicas. Usa exactamente:

   - `Parte I: Visión General`
   - `Parte II: Comentario`
   - `Parte III: Aplicación a la Vida`

5. Guarda solamente el Markdown traducido, sin cercos de código ni explicaciones, en `artifacts/teacher-translations/leccion-NN.md`.
6. Aplica la traducción mediante el generador seguro, sustituyendo `MODELO` por el identificador confirmado:

   ```text
   npm run resources:teacher -- apply --lesson LECCION --source artifacts/teacher-sources/leccion-NN.md --input artifacts/teacher-translations/leccion-NN.md --source-checksum CHECKSUM --producer "Google Antigravity" --model MODELO
   ```

7. Si cualquier validación falla, detente. No edites el HTML para evadir la salvaguarda.

## 4. Verificación final

Ejecuta, en este orden:

```text
npm run resources:test
npm run resources:audit
npm run build
git diff --check
git status --short
```

Comprueba además que:

- ningún archivo de `artifacts/` esté preparado para commit;
- cada traducción nueva tenga `method: "assisted-translation"` y `reviewStatus: "pending-review"`;
- el checksum de la traducción apunte al `sourceChecksum` validado;
- los recursos que no cambiaron permanezcan intactos.

## 5. Entrega

Si existen cambios reales, prepara únicamente los archivos de recursos, catálogo, manifiesto y scripts asociados; actualiza la rama `automation/weekly-resources` y crea o actualiza su PR de revisión. Incluye en el PR las lecciones traducidas, el modelo registrado, los resultados de pruebas y build, y la advertencia de revisión humana. No fusiones automáticamente el PR.

Si no existen cambios, informa que la comprobación semanal terminó sin novedades y no crees commits vacíos.
