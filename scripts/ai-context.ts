import fs from 'fs-extra';
import path from 'path';
import { globby } from 'globby';

const OUTPUT_FILE = 'llm.txt';

async function generateContext() {
  console.log('Generating AI context...');

  const sections: string[] = [];

  try {
    // 1. Project Structure
    console.log('Step 1: Globbing project structure...');
    const files = await globby(['**/*', '!node_modules', '!dist', '!.git', '!.beads', '!pnpm-lock.yaml'], {
      gitignore: true,
    });
    console.log(`Found ${files.length} files.`);
    sections.push('# Project Structure\n\n' + files.join('\n'));

    // 2. Core Documentation
    console.log('Step 2: Reading core documentation...');
    const docFiles = [
      'CLAUDE.md',
      'ARCHITECTURE.md',
      'README.md',
      'package.json',
      'ai-docs/SPEC.md',
      'ai-docs/PLAN.md',
      'ai-docs/TASKS.md',
      'ai-docs/CONTEXT.md',
      'ai-docs/LESSONS.md',
    ];

    for (const file of docFiles) {
      if (await fs.pathExists(file)) {
        console.log(`Reading ${file}...`);
        const content = await fs.readFile(file, 'utf-8');
        sections.push(`# File: ${file}\n\n${content}`);
      } else {
        console.log(`Skipping ${file} (not found)`);
      }
    }

    // 3. Design Documents
    console.log('Step 3: Reading design documents...');
    const designFiles = await globby(['**/DESIGN.md'], { gitignore: true });
    console.log(`Found ${designFiles.length} design files.`);
    for (const file of designFiles) {
      console.log(`Reading ${file}...`);
      const content = await fs.readFile(file, 'utf-8');
      sections.push(`# File: ${file}\n\n${content}`);
    }

    // Write output
    console.log('Step 4: Writing output...');
    await fs.writeFile(OUTPUT_FILE, sections.join('\n\n' + '='.repeat(80) + '\n\n'));
    console.log(`Context generated at ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error generating context:', error);
    process.exit(1);
  }
}

generateContext();
