#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
printf 'HeadHunter үшін байланыс email-ін енгізіңіз: '
read -r HH_CONTACT_EMAIL
export HH_CONTACT_EMAIL
printf 'OpenAI ЖИ кілтін қосасыз ба? (y/n): '
read -r answer
if [ "$answer" = 'y' ]; then
  printf 'OpenAI API key (енгізу жасырылған): '
  stty -echo
  read -r OPENAI_API_KEY
  stty echo
  printf '\n'
  export OPENAI_API_KEY
fi
trap 'unset OPENAI_API_KEY HH_CONTACT_EMAIL' EXIT
node server.mjs
