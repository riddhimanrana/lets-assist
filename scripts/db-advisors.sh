#!/bin/bash

# Advisors Check
# Runs Supabase security and performance advisors on the current schema
# Helps identify potential security vulnerabilities and performance improvements

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

LINKED=false
if [[ "${1:-}" == "--linked" ]]; then
  LINKED=true
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Supabase Advisors Check${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check CLI version
CLI_VERSION=$(supabase --version | grep -oE '([0-9]+\.[0-9]+\.[0-9]+)' || echo "unknown")
echo "Supabase CLI version: $CLI_VERSION"
echo ""

# Verify advisors are available (requires CLI 2.81.3+)
if ! supabase db advisors --help > /dev/null 2>&1; then
  echo -e "${YELLOW}⚠  Advisors feature requires Supabase CLI 2.81.3 or later${NC}"
  echo "   Current version: $CLI_VERSION"
  echo ""
  echo "To upgrade the CLI:"
  echo "  supabase update"
  echo ""
  exit 0
fi

if [[ "$LINKED" == "false" ]]; then
  # Check if local Supabase is running
  echo -e "${YELLOW}Checking local Supabase instance...${NC}"
  if ! bun run supabase:status > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠  Local Supabase is not running${NC}"
    echo ""
    read -p "Start local Supabase and reset to current migrations? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo "Starting Supabase..."
      bun run supabase:start
      echo "Waiting for database to be ready..."
      sleep 5

      echo "Resetting database to current migrations..."
      bun run supabase:reset
    else
      echo ""
      echo -e "${YELLOW}Advisors check requires a running local database${NC}"
      echo "Run: bun run supabase:start && bun run supabase:reset"
      exit 1
    fi
  fi

  echo -e "${GREEN}✓ Local Supabase is ready${NC}"
  echo ""
fi

echo -e "${YELLOW}Running advisors...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

ADVISOR_JSON="$(mktemp)"
trap 'rm -f "$ADVISOR_JSON"' EXIT

if [[ "$LINKED" == "true" ]]; then
  supabase db advisors --linked --output-format json > "$ADVISOR_JSON"
else
  supabase db advisors --local --output-format json > "$ADVISOR_JSON"
fi

TOTAL_ISSUES=$(jq '.results | length' "$ADVISOR_JSON")
SECURITY_ISSUES=$(jq '[.results[] | select(.categories[]? == "SECURITY")] | length' "$ADVISOR_JSON")
PERF_ISSUES=$(jq '[.results[] | select(.categories[]? == "PERFORMANCE")] | length' "$ADVISOR_JSON")

echo "Target: $([[ "$LINKED" == "true" ]] && echo "linked remote" || echo "local")"
echo "Total issues: $TOTAL_ISSUES"
echo "Security issues: $SECURITY_ISSUES"
echo "Performance issues: $PERF_ISSUES"
echo ""

if [ "$TOTAL_ISSUES" -gt 0 ]; then
  echo -e "${YELLOW}Issue counts by advisor:${NC}"
  jq -r '
    .results
    | group_by(.name)
    | map({ name: .[0].name, categories: (.[0].categories | join(",")), count: length })
    | sort_by(-.count, .name)
    | .[]
    | "  \(.count)x \(.name) [\(.categories)]"
  ' "$ADVISOR_JSON"
  echo ""

  echo -e "${YELLOW}Advisor details:${NC}"
  jq -r '
    .results[]
    | "• [\(.level)] \(.name): \(.detail)"
  ' "$ADVISOR_JSON"
else
  echo -e "${GREEN}✓ No advisor issues detected${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$SECURITY_ISSUES" -eq 0 ] && [ "$PERF_ISSUES" -eq 0 ]; then
  echo -e "${GREEN}✓ All advisors checks passed${NC}"
  echo ""
  echo "Your schema appears to be secure and performant."
  echo "Safe to deploy to production!"
else
  echo -e "${YELLOW}⚠  Advisors detected issues${NC}"
  echo ""
  echo "Review the recommendations above:"
  echo "  - ${RED}SECURITY issues${NC} should be fixed before production deployment"
  echo "  - ${YELLOW}PERFORMANCE recommendations${NC} are optional improvements"
  echo ""
  echo "Common issues:"
  echo "  • Missing Row Level Security (RLS) policies"
  echo "  • Unindexed columns frequently used in WHERE clauses"
  echo "  • Exposing sensitive views without WITH (security_invoker = true)"
  echo ""
  echo "For more details:"
  echo "  https://supabase.com/docs/guides/database/query-performance"
  echo "  https://supabase.com/docs/guides/security/rls"
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
