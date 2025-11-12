#!/usr/bin/env node

// Production entry point - runs compiled JavaScript from dist/

async function main() {
  const { execute } = await import('@oclif/core')
  await execute({ development: false, dir: import.meta.url })
}

main()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
