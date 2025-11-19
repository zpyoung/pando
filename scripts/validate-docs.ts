import fs from 'fs-extra';
import path from 'path';
import { globby } from 'globby';

async function validateDocs() {
  console.log('Validating documentation coverage...');
  let hasErrors = false;

  // Find all directories with .ts files
  const tsFiles = await globby(['src/**/*.ts', '!src/**/*.d.ts'], { gitignore: true });
  const dirs = new Set(tsFiles.map(f => path.dirname(f)));

  for (const dir of dirs) {
    // Count implementation files (excluding index.ts)
    const filesInDir = await fs.readdir(dir);
    const implFiles = filesInDir.filter(f => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.d.ts'));

    if (implFiles.length >= 2) {
      const designPath = path.join(dir, 'DESIGN.md');
      if (!(await fs.pathExists(designPath))) {
        console.error(`[MISSING] ${dir}/DESIGN.md (Found ${implFiles.length} implementation files)`);
        hasErrors = true;
      }
    }
  }

  if (hasErrors) {
    console.error('\nValidation failed: Missing DESIGN.md files.');
    process.exit(1);
  } else {
    console.log('Validation passed: All required DESIGN.md files exist.');
  }
}

validateDocs().catch(console.error);
