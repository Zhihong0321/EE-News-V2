/**
 * Deployment Verification Script
 * Run this locally to verify your build is ready for Railway
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🔍 Verifying Railway Deployment Readiness...\n');

let allChecks = true;

// Check 1: Package.json has correct scripts
console.log('✓ Checking package.json scripts...');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (!packageJson.scripts.build || !packageJson.scripts.start) {
    console.error('❌ Missing build or start script in package.json');
    allChecks = false;
} else {
    console.log('  ✓ build script: ' + packageJson.scripts.build);
    console.log('  ✓ start script: ' + packageJson.scripts.start);
}

// Check 2: Dockerfile exists
console.log('\n✓ Checking Dockerfile...');
if (!existsSync('Dockerfile')) {
    console.error('❌ Dockerfile not found');
    allChecks = false;
} else {
    console.log('  ✓ Dockerfile exists');
}

// Check 3: railway.json exists
console.log('\n✓ Checking railway.json...');
if (!existsSync('railway.json')) {
    console.error('❌ railway.json not found');
    allChecks = false;
} else {
    const railwayConfig = JSON.parse(readFileSync('railway.json', 'utf8'));
    console.log('  ✓ railway.json exists');
    console.log('  ✓ Builder: ' + railwayConfig.build.builder);
}

// Check 4: Schema uses safe CREATE statements
console.log('\n✓ Checking database schema safety...');
const schema = readFileSync('server/schema.sql', 'utf8');
if (schema.includes('DROP TABLE')) {
    console.error('❌ WARNING: Schema contains DROP TABLE statements!');
    allChecks = false;
} else if (!schema.includes('IF NOT EXISTS')) {
    console.error('❌ WARNING: Schema missing IF NOT EXISTS clauses!');
    allChecks = false;
} else {
    console.log('  ✓ Schema uses CREATE TABLE IF NOT EXISTS');
    console.log('  ✓ No DROP TABLE statements found');
}

// Check 5: Server serves static files correctly
console.log('\n✓ Checking server configuration...');
const serverJs = readFileSync('server/server.js', 'utf8');
if (!serverJs.includes('express.static')) {
    console.error('❌ Server not configured to serve static files');
    allChecks = false;
} else {
    console.log('  ✓ Server configured to serve static files from dist/');
}

// Check 6: Environment variables
console.log('\n✓ Checking environment configuration...');
const dbJs = readFileSync('server/db.js', 'utf8');
if (!dbJs.includes('process.env.DATABASE_URL')) {
    console.error('❌ DATABASE_URL not configured');
    allChecks = false;
} else {
    console.log('  ✓ DATABASE_URL configured');
}

if (!dbJs.includes('ssl')) {
    console.warn('⚠️  WARNING: SSL configuration not found (may be needed for Railway Postgres)');
} else {
    console.log('  ✓ SSL configuration present');
}

// Check 7: Build output
console.log('\n✓ Checking build output...');
if (!existsSync('dist')) {
    console.warn('⚠️  dist/ folder not found. Run "npm run build" first.');
} else {
    if (!existsSync('dist/index.html')) {
        console.error('❌ dist/index.html not found');
        allChecks = false;
    } else {
        console.log('  ✓ dist/index.html exists');
    }
    if (!existsSync('dist/assets')) {
        console.error('❌ dist/assets/ not found');
        allChecks = false;
    } else {
        console.log('  ✓ dist/assets/ exists');
    }
}

// Check 8: Task Manager routes
console.log('\n✓ Checking Task Manager integration...');
const appJsx = readFileSync('src/App.jsx', 'utf8');
if (!appJsx.includes('TaskManager')) {
    console.error('❌ TaskManager not imported in App.jsx');
    allChecks = false;
} else {
    console.log('  ✓ TaskManager component integrated');
}

if (!appJsx.includes('/manage-task')) {
    console.error('❌ /manage-task route not configured');
    allChecks = false;
} else {
    console.log('  ✓ /manage-task route configured');
}

// Final summary
console.log('\n' + '='.repeat(50));
if (allChecks) {
    console.log('✅ All checks passed! Ready for Railway deployment.');
    console.log('\nNext steps:');
    console.log('1. Push code to GitHub');
    console.log('2. Connect Railway to your repository');
    console.log('3. Set DATABASE_URL environment variable');
    console.log('4. Deploy!');
} else {
    console.log('❌ Some checks failed. Please fix the issues above.');
    process.exit(1);
}
console.log('='.repeat(50));
