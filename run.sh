#!/bin/bash
# Install dependencies if not present (bun handles this well usually, but good to be safe)
if [ ! -d "node_modules" ]; then
    bun install
fi

# Run the typescript script using bun
bun run index.ts
