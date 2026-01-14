#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo "  HoneyBadger Switch Manager (Mac/Linux)"
echo "=========================================="

# Check for Node
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed!"
    echo "Please install it from https://nodejs.org/"
    exit 1
fi

echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "Starting Manager..."
echo "Access at: http://localhost:5173"
echo ""
npm run dev
