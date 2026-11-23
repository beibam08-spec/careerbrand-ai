#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Node.js 20+ қажет'; exit 1; }
printf 'OpenAI API key (тергенде көрінбейді): '
trap "stty echo 2>/dev/null || true" EXIT INT TERM
stty -echo
IFS= read -r OPENAI_API_KEY
stty echo
trap - EXIT INT TERM
printf '\n'
[ -n "$OPENAI_API_KEY" ] || { echo 'Кілт енгізілмеді.'; exit 1; }
export OPENAI_API_KEY
printf 'Сайт: http://127.0.0.1:3000\n'
node server.mjs
