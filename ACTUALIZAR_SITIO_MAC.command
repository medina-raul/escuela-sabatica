#!/bin/sh
set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

printf '%s\n' '================================================================'
printf '%s\n' '  ESCUELA SABÁTICA CL - ACTUALIZACIÓN INTEGRAL'
printf '%s\n' '================================================================'
printf '%s\n\n' 'Esta ventana revisará, actualizará, publicará y comprobará el sitio.'

"$PROJECT_DIR/scripts/run_resource_update.command"
RESULT=$?

if [ "$RESULT" -eq 0 ]; then
  printf '\nPROCESO COMPLETADO CORRECTAMENTE.\n'
else
  printf '\nEL PROCESO SE DETUVO DE FORMA SEGURA.\n'
  printf '%s\n' 'Envía al administrador artifacts/site-maintenance-report.json'
fi

printf '\nPresiona Enter para cerrar...'
read -r _answer
exit "$RESULT"
