#!/usr/bin/env bash
# Verificación con salida corta: typecheck, lint y pruebas de la API y/o la web.
# Uso: check.sh [api|web|all] [--e2e]
# Imprime una línea por etapa y, si algo falla, solo las líneas del error.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET="${1:-all}"
E2E=false; [[ "${2:-}" == "--e2e" || "${1:-}" == "--e2e" ]] && E2E=true
[[ "$TARGET" == "--e2e" ]] && TARGET=all
source ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use 24 >/dev/null 2>&1
FAILED=0

run() { # nombre, carpeta, comando, filtro-de-resumen
  local name="$1" dir="$2" cmd="$3" summary="$4" out
  out="$(cd "$ROOT/$dir" && eval "$cmd" 2>&1)"; local code=$?
  if [[ $code -eq 0 ]]; then
    local s; s="$(grep -E "$summary" <<<"$out" | tail -n 2 | tr -s ' ' | paste -sd ' ' -)"
    echo "✔ $name ${s:+— $s}"
  else
    FAILED=1
    echo "✘ $name"
    grep -E "error|Error|FAIL|✘|×|AssertionError|expected|Expected|Received|❯ .*:[0-9]+" <<<"$out" \
      | grep -vE "DeprecationWarning|trace-deprecation" | head -n 25 | sed 's/^/    /'
  fi
}

if [[ "$TARGET" == api || "$TARGET" == all ]]; then
  run "api typecheck" barbersaas-api "npx tsc --noEmit -p ." "^$"
  run "api lint"      barbersaas-api "npx eslint src test --quiet" "^$"
  run "api unit"      barbersaas-api "pnpm -s test" "Tests "
  $E2E && run "api e2e" barbersaas-api "pnpm -s test:e2e" "Test Files|Tests "
fi
if [[ "$TARGET" == web || "$TARGET" == all ]]; then
  run "web typecheck" barbersaas-web "npx tsc -b" "^$"
  run "web lint"      barbersaas-web "npx eslint src e2e" "^$"
  run "web unit"      barbersaas-web "npx vitest run" "Tests "
  $E2E && run "web e2e" barbersaas-web "pnpm exec playwright test --reporter=line" "passed|failed"
fi
exit $FAILED
