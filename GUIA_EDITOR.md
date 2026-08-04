# Guía del editor — actualización del sitio

## Uso normal

En Windows, abre la carpeta del proyecto y haz doble clic en:

```text
ACTUALIZAR_SITIO_WINDOWS.cmd
```

No cierres la ventana. El proceso puede tardar varios minutos porque revisa Internet, reconstruye el sitio y espera el despliegue de Vercel.

La primera vez puede:

1. Solicitar permiso de Windows para instalar una herramienta faltante.
2. Abrir el navegador para autorizar la cuenta de GitHub.
3. Tardar más mientras instala las librerías exactas del proyecto.

En las siguientes ejecuciones sólo hay que volver a hacer doble clic.

## Resultados posibles

### PROCESO COMPLETADO CORRECTAMENTE

Significa que:

- el repositorio local quedó sincronizado;
- las fuentes y la bandeja manual fueron procesadas;
- pruebas, build y enlaces fueron aprobados;
- cualquier cambio se publicó y fusionó mediante PR;
- Vercel desplegó el resultado;
- el sitio público y la copia local fueron comprobados.

### EL PROCESO SE DETUVO DE FORMA SEGURA

No intentes corregirlo con comandos. Envía al administrador este archivo:

```text
artifacts/site-maintenance-report.json
```

El sistema se detiene cuando encuentra trabajo local, un conflicto, una ruta inesperada, una comprobación fallida o una traducción que necesita un agente. Nunca descarta ni sobrescribe esos casos.

## Recursos colocados manualmente

Los archivos manuales se dejan bajo:

```text
resource-inbox/<trimestre>/
```

respetando la misma organización de `public/recursos/<trimestre>/`. Después basta con ejecutar el acceso directo. No copies archivos directamente a `public/recursos/` ni uses Git manualmente.

## Ejecución semanal

GitHub ejecuta el actualizador automáticamente cada lunes. El acceso directo se usa cuando se quiere adelantar una revisión, incorporar archivos manuales o confirmar que la computadora local está sincronizada.
