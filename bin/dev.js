#!/usr/bin/env node

// Development entry point - runs TypeScript source directly with ts-node
// Use this during development for faster iteration without compilation

async function main() {
  const { execute } = await import('@oclif/core')
  await execute({ development: true, dir: import.meta.url })
}

main()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
