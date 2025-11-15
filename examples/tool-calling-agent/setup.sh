#!/bin/bash

# Tool Calling Agent - Setup Script
# Idempotent setup for the tool calling example framework

set -e

echo "🔧 Tool Calling Agent - Setup"
echo "════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Step 1: Check .env exists
echo "📋 Checking environment configuration..."
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    echo ""
    echo "In dev mode, the .env should be copied automatically by quickstart."
    echo "If you're setting this up manually, create a .env file with:"
    echo ""
    echo "  NEO4J_URI=bolt://localhost:7691"
    echo "  NEO4J_USERNAME=neo4j"
    echo "  NEO4J_PASSWORD=<your-password>"
    echo "  NEO4J_DATABASE=neo4j"
    echo "  GEMINI_API_KEY=<your-api-key>"
    echo ""
    exit 1
fi
echo -e "${GREEN}✓${NC} .env found"

# Load .env
export $(cat .env | grep -v '^#' | xargs)

# Step 2: Check Docker is running
echo ""
echo "🐳 Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo "Please start Docker and try again"
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker is running"

# Step 3: Check Neo4j container
echo ""
echo "📦 Checking Neo4j container..."

CONTAINER_NAME=$(grep 'container_name:' docker-compose.yml | awk '{print $2}')
CONTAINER_EXISTS=$(docker ps -a --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}" || echo "")

if [ -z "$CONTAINER_EXISTS" ]; then
    echo -e "${YELLOW}⚠${NC}  Container not found, creating..."
    docker compose up -d
    echo -e "${GREEN}✓${NC} Container created and started"

    # Wait for Neo4j to be ready
    echo "⏳ Waiting for Neo4j to be ready..."
    sleep 15
    echo -e "${GREEN}✓${NC} Neo4j should be ready"
else
    CONTAINER_RUNNING=$(docker ps --filter "name=^${CONTAINER_NAME}$" --format "{{.Names}}" || echo "")

    if [ -z "$CONTAINER_RUNNING" ]; then
        echo -e "${YELLOW}⚠${NC}  Container exists but not running, starting..."
        docker start "$CONTAINER_NAME"
        sleep 5
        echo -e "${GREEN}✓${NC} Container started"
    else
        echo -e "${GREEN}✓${NC} Container already running"
    fi
fi

# Step 4: Check if database has data
echo ""
echo "🗄️  Checking database content..."

# Simple cypher query to count nodes
NODE_COUNT=$(docker exec -i "$CONTAINER_NAME" cypher-shell \
    -u "$NEO4J_USERNAME" \
    -p "$NEO4J_PASSWORD" \
    -d "$NEO4J_DATABASE" \
    "MATCH (n:Scope) RETURN count(n) as count" 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")

if [ "$NODE_COUNT" -lt 100 ]; then
    echo -e "${YELLOW}⚠${NC}  Database appears empty (found $NODE_COUNT scopes)"
    echo "   You need to ingest the codebase:"
    echo ""
    echo "   cd $SCRIPT_DIR"
    echo "   npm run ingest"
    echo ""
    echo -e "${YELLOW}⚠${NC}  Setup incomplete - please run ingestion"
else
    echo -e "${GREEN}✓${NC} Database has data ($NODE_COUNT scopes found)"
fi

# Step 5: Check node_modules
echo ""
echo "📦 Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠${NC}  Dependencies not installed, installing..."
    npm install
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${GREEN}✓${NC} Dependencies already installed"
fi

# Step 6: Summary
echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ Setup complete!${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "🚀 Quick start:"
echo "   npm run query           # Interactive query mode"
echo "   npm run test:tools      # Test tool calling"
echo ""
echo "📚 Neo4j Browser: http://localhost:7478"
echo "🔌 Neo4j Bolt:    $NEO4J_URI"
echo ""
