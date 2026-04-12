#!/bin/bash

# Dry-Run Schema Check
# Safely shows what would be deployed to production WITHOUT making any changes
# This connects to the linked production database but uses --dry-run

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Supabase Production Dry-Run${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if SUPABASE_ACCESS_TOKEN is set
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo -e "${YELLOW}⚠  SUPABASE_ACCESS_TOKEN not set in environment${NC}"
  echo ""
  echo "To run a production dry-run, you need:"
  echo "1. SUPABASE_ACCESS_TOKEN environment variable (from Supabase dashboard)"
  echo "2. SUPABASE_PROJECT_ID in supabase/.env.local"
  echo ""
  echo "Set the access token:"
  echo "  export SUPABASE_ACCESS_TOKEN='sbp_xxxxxxxxxxxxx'"
  echo ""
  exit 1
fi

# Try to get project ID from .env.local or environment
PROJECT_ID="${SUPABASE_PROJECT_ID:-}"

if [ -z "$PROJECT_ID" ] && [ -f "supabase/.env.local" ]; then
  PROJECT_ID=$(grep "SUPABASE_PROJECT_ID" supabase/.env.local | cut -d= -f2 | tr -d ' ')
fi

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}❌ SUPABASE_PROJECT_ID not found${NC}"
  echo ""
  echo "Set it in supabase/.env.local:"
  echo "  SUPABASE_PROJECT_ID=your-project-id"
  echo ""
  exit 1
fi

echo -e "${YELLOW}Connecting to production database...${NC}"
echo "  Project ID: $PROJECT_ID"
echo ""

# Link to production
if ! supabase link --project-ref "$PROJECT_ID" > /dev/null 2>&1; then
  echo -e "${RED}❌ Failed to link to production database${NC}"
  echo "Check your SUPABASE_ACCESS_TOKEN and PROJECT_ID"
  exit 1
fi

echo -e "${GREEN}✓ Linked to production database${NC}"
echo ""

# Show migrations that would be applied
echo -e "${YELLOW}Checking pending migrations...${NC}"
echo ""

# Try to show diff
if supabase db diff-remote 2>/dev/null; then
  echo ""
  echo -e "${GREEN}✓ Diff retrieved${NC}"
else
  echo -e "${YELLOW}No pending migrations or diff unavailable${NC}"
fi

echo ""
echo -e "${YELLOW}Running dry-run simulation...${NC}"
echo ""

# Simulate what would happen (safe - no changes)
if supabase db push --linked --dry-run; then
  echo ""
  echo -e "${GREEN}✓ Dry-run successful - production deployment would succeed${NC}"
else
  echo ""
  echo -e "${YELLOW}⚠ Dry-run detected potential issues${NC}"
  echo "  Fix the issues above before pushing to production"
  exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Dry-Run Complete - No changes were made${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "To actually deploy to production:"
echo "  1. Open a PR with your schema changes (development → main)"
echo "  2. GitHub Actions will run full validation"
echo "  3. Merge the PR to auto-deploy"
echo ""
echo "Or manually deploy:"
echo "  supabase db push --linked --yes"
echo ""
