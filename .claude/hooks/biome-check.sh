#!/bin/bash
# Runs biome check --write on the file Claude just edited/wrote.
# Receives PostToolUse JSON on stdin.

FILE_PATH=$(cat | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d)?.tool_input?.file_path||'')}catch{}})")

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Run from repo root so biome.json is picked up
cd "$CLAUDE_PROJECT_DIR" || exit 0

pnpm exec biome check --write --files-ignore-unknown=true --no-errors-on-unmatched "$FILE_PATH" 2>/dev/null

exit 0  # Never block Claude — we're formatting, not gating
