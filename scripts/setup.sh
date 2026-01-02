#!/bin/bash
#
# RagForge Setup Script
# Sets up the development environment with Neo4j and optional Ollama
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

RAGFORGE_DIR="$HOME/.ragforge"
ENV_FILE="$RAGFORGE_DIR/.env"
NEO4J_BOLT_PORT=7687
NEO4J_HTTP_PORT=7474

echo -e "${BLUE}"
echo "  ____             _____                    "
echo " |  _ \\ __ _  __ _|  ___|__  _ __ __ _  ___ "
echo " | |_) / _\` |/ _\` | |_ / _ \\| '__/ _\` |/ _ \\"
echo " |  _ < (_| | (_| |  _| (_) | | | (_| |  __/"
echo " |_| \\_\\__,_|\\__, |_|  \\___/|_|  \\__, |\\___|"
echo "             |___/               |___/      "
echo -e "${NC}"
echo "RagForge Setup Script"
echo "====================="
echo ""

# Function to generate random password
generate_password() {
    openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 16
}

# Check for Docker
echo -e "${BLUE}[1/4]${NC} Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker daemon is not running.${NC}"
    echo "Please start Docker and try again."
    exit 1
fi
echo -e "${GREEN}Docker is installed and running.${NC}"

# Check for docker-compose
echo -e "${BLUE}[2/4]${NC} Checking docker-compose..."
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    echo -e "${RED}ERROR: docker-compose is not installed.${NC}"
    echo "Please install docker-compose: https://docs.docker.com/compose/install/"
    exit 1
fi
echo -e "${GREEN}Using: $COMPOSE_CMD${NC}"

# Create RagForge directory and .env file
echo -e "${BLUE}[3/4]${NC} Setting up configuration..."
if [ ! -d "$RAGFORGE_DIR" ]; then
    mkdir -p "$RAGFORGE_DIR"
    echo -e "${GREEN}Created $RAGFORGE_DIR${NC}"
fi

if [ ! -f "$ENV_FILE" ]; then
    PASSWORD=$(generate_password)
    cat > "$ENV_FILE" << EOF
# RagForge Neo4j Configuration
NEO4J_URI=bolt://localhost:${NEO4J_BOLT_PORT}
NEO4J_DATABASE=neo4j
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=${PASSWORD}

# API Keys (add your keys here)
# GEMINI_API_KEY=your_key_here
# REPLICATE_API_TOKEN=your_token_here
EOF
    echo -e "${GREEN}Created $ENV_FILE with auto-generated password${NC}"
else
    echo -e "${YELLOW}$ENV_FILE already exists, keeping existing configuration.${NC}"
    # Source the existing password
    source "$ENV_FILE" 2>/dev/null || true
fi

# Export the password for docker-compose
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Start Neo4j with docker-compose
echo -e "${BLUE}[4/4]${NC} Starting Neo4j..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

if [ -f "docker-compose.yml" ]; then
    $COMPOSE_CMD --env-file "$ENV_FILE" up -d
    echo -e "${GREEN}Neo4j container started!${NC}"
else
    echo -e "${RED}ERROR: docker-compose.yml not found in $PROJECT_DIR${NC}"
    exit 1
fi

# Wait for Neo4j to be ready
echo ""
echo -e "${YELLOW}Waiting for Neo4j to be ready...${NC}"
for i in {1..30}; do
    if curl -s "http://localhost:$NEO4J_HTTP_PORT" > /dev/null 2>&1; then
        echo -e "${GREEN}Neo4j is ready!${NC}"
        break
    fi
    echo -n "."
    sleep 2
done
echo ""

# Summary
echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}       Setup Complete!              ${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "Neo4j Browser: ${BLUE}http://localhost:$NEO4J_HTTP_PORT${NC}"
echo -e "Bolt URI:      ${BLUE}bolt://localhost:$NEO4J_BOLT_PORT${NC}"
echo -e "Config file:   ${BLUE}$ENV_FILE${NC}"
echo ""
echo "Next steps:"
echo "  1. Add your API keys to $ENV_FILE (optional)"
echo "  2. Run 'npm install' to install dependencies"
echo "  3. Start using RagForge MCP with Claude Code!"
echo ""

# Optional: Check for Ollama
echo -e "${YELLOW}Optional: Ollama for local embeddings${NC}"
if command -v ollama &> /dev/null; then
    echo -e "${GREEN}Ollama is installed.${NC}"
    if curl -s "http://localhost:11434" > /dev/null 2>&1; then
        echo -e "${GREEN}Ollama is running.${NC}"
    else
        echo "Run 'ollama serve' to start Ollama."
    fi
else
    echo "Ollama is not installed. For free local embeddings, install from: https://ollama.ai"
fi
