# Guía del editor — actualización del sitio

## Primera instalación sin comandos

El administrador debe entregar un único archivo y dejarlo en el Escritorio:

- Windows: `INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd`
- macOS: `INSTALAR_Y_ACTUALIZAR_MAC.command`

Al abrirlo por primera vez, el instalador reutiliza el repositorio si está en la misma carpeta. Si no lo encuentra, crea una copia oficial en:

- Windows: `%USERPROFILE%\EscuelaSabaticaCL`
- macOS: `$HOME/EscuelaSabaticaCL`

Después instala los requisitos disponibles, solicita autorización de GitHub y lanza el ciclo completo. No es necesario copiar archivos a la raíz ni escribir comandos.

En macOS, la primera apertura de un archivo descargado puede requerir clic derecho → **Abrir**.

## Uso normal

En Windows, haz doble clic en el instalador guardado en el Escritorio:

```text
INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd
```

También se puede abrir directamente desde la carpeta del proyecto:

```text
ACTUALIZAR_SITIO_WINDOWS.cmd
```

No cierres la ventana. El proceso puede tardar varios minutos porque revisa Internet, reconstruye el sitio y espera el despliegue de Vercel.

La primera vez puede:

1. Solicitar permiso de Windows para instalar una herramienta faltante.
2. Abrir el navegador para autorizar la cuenta de GitHub.
3. Tardar más mientras instala las librerías exactas del proyecto.

En las siguientes ejecuciones sólo hay que volver a hacer doble clic.

## Entrega inmediata al equipo del editor

1. Descarga `INSTALAR_Y_ACTUALIZAR_WINDOWS.cmd` desde `medina-raul/main`.
2. Déjalo en el Escritorio del editor.
3. Pide al editor que cierre Antigravity antes de la primera ejecución.
4. Haz doble clic en el instalador y acepta las instalaciones de Windows.
5. Cuando se abra GitHub, inicia sesión con una cuenta que tenga escritura en `medina-raul/escuela-sabatica`.
6. Espera el mensaje `PROCESO COMPLETADO CORRECTAMENTE`.
7. Abre en Antigravity la carpeta `%USERPROFILE%\EscuelaSabaticaCL`.

Si Antigravity ya trabaja sobre otra copia del repositorio, el administrador debe guardar primero cualquier cambio legítimo. El instalador nunca fuerza, descarta ni mezcla trabajo local divergente.

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
