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

# Run security advisors
echo -e "${YELLOW}Running Security Advisors...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
SECURITY_ISSUES=0

if supabase db advisors --linked=false | grep -q "SECURITY"; then
  SECURITY_ISSUES=1
  supabase db advisors --linked=false | grep -A 2 "SECURITY" || true
fi

if [ $SECURITY_ISSUES -eq 0 ]; then
  echo -e "${GREEN}✓ No security issues detected${NC}"
fi
echo ""

# Run performance advisors
echo -e "${YELLOW}Running Performance Advisors...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
PERF_ISSUES=0

if supabase db advisors --linked=false | grep -q "PERFORMANCE"; then
  PERF_ISSUES=1
  supabase db advisors --linked=false | grep -A 2 "PERFORMANCE" || true
fi

if [ $PERF_ISSUES -eq 0 ]; then
  echo -e "${GREEN}✓ No performance issues detected${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $SECURITY_ISSUES -eq 0 ] && [ $PERF_ISSUES -eq 0 ]; then
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
