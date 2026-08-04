# Bandeja manual de recursos

Esta carpeta recibe archivos que no provienen de una URL automatizada. Su contenido de trabajo se ignora en Git porque el pipeline copia la versión validada a `public/recursos/` y registra su checksum en el catálogo.

## Actualizar un recurso manual existente

Replica dentro del trimestre la ruta que el recurso tiene después de `/recursos/<trimestre>/`. Por ejemplo:

```text
resource-inbox/
└── 2026-q3/
    └── lecturas/
        └── viernes/
            └── leccion-01.html
```

Después ejecuta `npm run resources:plan` para revisar y `npm run resources:sync` para aplicar.

## Agregar un recurso manual nuevo

Junto al archivo agrega un descriptor cuyo nombre sea `<archivo>.resource.json`. Ejemplo para `estudio-especial.html`:

```json
{
  "id": "reading-general-estudio-especial",
  "type": "article",
  "role": "general-reading",
  "title": "Estudio especial",
  "description": "Lectura complementaria"
}
```

Los campos `lessonNumber`, `dayId`, `provider`, `providerUrl` y `credit` son opcionales cuando correspondan. El archivo sólo se importa si pasa las validaciones de extensión, contenido y tamaño y si su ubicación coincide con la plantilla canónica del rol.
