#!/bin/bash

# Validate migration files without starting or changing a database.
# Run bun run db:test:redesign separately for an owned isolated replay.

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
echo -e "${YELLOW}[Stage 1/3]${NC} Validating migration file formats..."
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
echo -e "${YELLOW}[Stage 2/3]${NC} Checking for duplicate migration timestamps..."
timestamps=$(ls -1 supabase/migrations/*.sql | grep -v '.gitkeep' | sed 's/.*\///' | cut -d_ -f1 | sort)
if [ $(echo "$timestamps" | wc -l) -ne $(echo "$timestamps" | sort -u | wc -l) ]; then
  echo -e "${RED}❌ Duplicate migration timestamps detected${NC}"
  exit 1
fi
echo -e "${GREEN}✓ No duplicate timestamps${NC}"
echo ""

# Stage 3: Ensure migrations have descriptions
echo -e "${YELLOW}[Stage 3/3]${NC} Checking migration descriptions..."
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

echo "Migration file checks passed. No database was changed."
echo "Replay and security checks were not run. Use bun run db:test:redesign for an owned isolated stack."
