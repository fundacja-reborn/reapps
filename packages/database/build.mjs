#!/usr/bin/env node

import { copyFile, mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  console.log('🔨 Building @reborn/database...');
  
  try {
    // Clean dist directory
    await rm(join(__dirname, 'dist'), { recursive: true, force: true });
    await mkdir(join(__dirname, 'dist'), { recursive: true });
    
    // Generate Prisma Client
    console.log('📦 Generating Prisma Client...');
    await execAsync('prisma generate', { cwd: __dirname });
    
    // Compile TypeScript
    console.log('🔧 Compiling TypeScript...');
    await execAsync('tsc --project tsconfig.lib.json', { cwd: __dirname });
    
    // Create package.json for dist
    const distPackageJson = {
      type: 'module',
      main: './index.js',
      types: './index.d.ts'
    };
    
    await writeFile(
      join(__dirname, 'dist', 'package.json'),
      JSON.stringify(distPackageJson, null, 2)
    );
    
    console.log('✅ Build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
