#!/bin/bash

# Database Validation Script
#
# NOTE: this is a lint plus replay smoke test, not the schema gate. It checks
# migration file naming, duplicate timestamps, description comments, and that
# the ledger replays. It checks nothing about RLS, policies, grants, or
# advisors. The gate for anything schema-shaped is `bun run db:test:redesign`,
# which spins a fresh isolated stack and runs the pgTAP suite plus the
# architecture, plugin-isolation, registry, contract, and browser checks.
#
# This script is also interactive, so it is not suitable for CI.
#
# 1. Validates migration file formats
# 2. Tests migration replay with local reset
# 3. Shows pending changes
# 4. Optionally runs security advisors

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Supabase Schema Validation${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Stage 1: Validate migration file formats
echo -e "${YELLOW}[Stage 1/4]${NC} Validating migration file formats..."
INVALID_FILES=0

for file in supabase/migrations/*.sql; do
  # Skip .gitkeep
  if [[ $(basename "$file") == ".gitkeep" ]]; then
    continue
  fi
  
  # Must match pattern: YYYYMMDDHHMMSS_description.sql
  if ! [[ $(basename "$file") =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo -e "${RED}  ✗ Invalid filename: $(basename "$file")${NC}"
    echo -e "    Expected format: YYYYMMDDHHMMSS_description.sql"
    INVALID_FILES=$((INVALID_FILES + 1))
  else
    echo -e "${GREEN}  ✓ $(basename "$file")${NC}"
  fi
done

if [ $INVALID_FILES -gt 0 ]; then
  echo -e "${RED}❌ Found $INVALID_FILES invalid migration file(s)${NC}"
  exit 1
fi

echo -e "${GREEN}✓ All migration filenames are valid${NC}"
echo ""

# Stage 2: Check for duplicate timestamps
echo -e "${YELLOW}[Stage 2/4]${NC} Checking for duplicate migration timestamps..."
timestamps=$(ls -1 supabase/migrations/*.sql | grep -v '.gitkeep' | sed 's/.*\///' | cut -d_ -f1 | sort)
if [ $(echo "$timestamps" | wc -l) -ne $(echo "$timestamps" | sort -u | wc -l) ]; then
  echo -e "${RED}❌ Duplicate migration timestamps detected${NC}"
  exit 1
fi
echo -e "${GREEN}✓ No duplicate timestamps${NC}"
echo ""

# Stage 3: Ensure migrations have descriptions
echo -e "${YELLOW}[Stage 3/4]${NC} Checking migration descriptions..."
MISSING_DESC=0
for file in supabase/migrations/*.sql; do
  if [[ $(basename "$file") == ".gitkeep" ]]; then
    continue
  fi
  # First non-empty line should be a comment
  if ! head -5 "$file" | grep -q "^--"; then
    echo -e "${YELLOW}  ⚠ $(basename "$file") missing description comment${NC}"
    MISSING_DESC=$((MISSING_DESC + 1))
  fi
done

if [ $MISSING_DESC -gt 0 ]; then
  echo -e "${YELLOW}⚠ Warning: $MISSING_DESC migration(s) missing description comments${NC}"
  echo -e "  Consider adding a comment explaining what each migration does"
else
  echo -e "${GREEN}✓ All migrations have descriptions${NC}"
fi
echo ""

# Stage 4: Check if Supabase is running, offer to start if needed
echo -e "${YELLOW}[Stage 4/4]${NC} Checking local Supabase instance..."
if ! bun run supabase:status > /dev/null 2>&1; then
  echo -e "${YELLOW}⚠ Local Supabase is not running${NC}"
  echo ""
  read -p "Start local Supabase? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting Supabase..."
    bun run supabase:start
    echo "Waiting for database to be ready..."
    sleep 5
    
    # Verify it's running
    if ! bun run supabase:status > /dev/null 2>&1; then
      echo -e "${RED}❌ Failed to start Supabase${NC}"
      exit 1
    fi
  else
    echo -e "${YELLOW}Skipping local validation (required to test migrations)${NC}"
    echo ""
    echo -e "${BLUE}Summary:${NC}"
    echo -e "  Migration format validation: ${GREEN}PASSED${NC}"
    echo ""
    echo -e "${YELLOW}Recommendation:${NC}"
    echo "  Run 'bun run supabase:start' and 'bun db:validate' to test migrations locally"
    exit 0
  fi
fi

echo -e "${GREEN}✓ Local Supabase is running${NC}"
echo ""

# Test migration replay
echo -e "${BLUE}Testing migration replay with local reset...${NC}"
if bun run supabase:reset; then
  echo -e "${GREEN}✓ Migration replay successful${NC}"
else
  echo -e "${RED}❌ Migration replay failed${NC}"
  echo "See errors above. Fix the issues before pushing to production."
  exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ All validations passed!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo "1. Review your changes: git diff supabase/migrations/"
echo "2. Commit and push: git push origin development"
echo "3. Create a PR merging development → main"
echo "4. CI validates on merge. Production schema deployment is NOT automatic:"
echo "   it requires a manual workflow_dispatch of deploy-schema.yml with the"
echo "   exact production_confirmation input."
echo ""
echo "To see pending migrations before production deploy:"
echo "  supabase db diff-remote"
echo ""
